const router = require('express').Router();
const { Octokit } = require("@octokit/core");

const config = require('../config');
const baseUrl = process.env.BASE_URL || '';

// Data that should be used when rendering any response
const DATA = {
    githubHost: config.host,
    baseUrl,
};

router.get('/', (req, resp, next) => {
  resp.render('index', DATA);
});

router.get('/:courseId', (req, resp, next) => {
  resp.render('prompt-for-github-name', DATA);
});


router.post('/:courseId', async (req, resp, next) => {
  // We'll accumulate data in this object as we go to make rendering easy
  const data = { ...DATA };

  // Ensure a username is present
  const githubUserName = req.body.githubName

  // Find NetID
  let netid;
  if (process.env.NODE_ENV === 'development') {
    // No shib locally
    // Default to "dev", override with NETID environment variable
    netid = process.env.NETID || 'dev';
  } else {
    const email = req.get('eppn');
    if (!email || email.length === 0) {
      throw {
        text: 'We were unable to authenticate your NetID.  Please try again later.',
        call: "shib"
      };
    }
    netid = email.split('@')[0];
  }
  data.netid = netid;

  // Lookup course info in config
  const { courseId } = req.params;
  const course = config.courses.find(c => c.id === courseId);
  if (!course) {
    throw {
      text: 'Unknown course ID!',
      call: "course config"
    }
  }
  data.courseName = course.name;
  data.courseId = course.id;

  const githubToken = course.token;
  if (!githubToken) {
    throw {
      text: 'No course token found',
      call: 'course token'
    }
  }

  repoName = `cs240-fa21-${netid}`
  data.studentRepoUrl = `${config.host}/${course.org}/${repoName}`;

  // Set up a new Octokit instance for this request
  const octokit = new Octokit({ auth: githubToken });

  // Check if user is in the org:
  try {
    let r = await octokit.request('GET /orgs/{org}/members/{username}', {
      org: 'cs240-illinois',
      username: githubUserName
    })
    console.log(r.status);  // 204 := found!
  } catch (e) {
    // Not in the org:
    resp.render('get-invited', data);
    return;
  }

  // If they are, create the repo:
  try {
    await octokit.request('POST /orgs/{org}/repos', {
      org: 'cs240-illinois',
      name: repoName,
      private: true,
      has_issues: false,
      has_wiki: false,
      description: `${config.semester} repository for ${netid}`,      
    })
  } catch (err) {
    if (err.status == 422) {
      // Response: Repo already exists
      //resp.render('repoReady', data);
      //return;
    } else {

      // Response: Unknown error and log it
      console.log(err);
      next({
        text: 'We recieved an unknown response from github.  Please try again later.',
        call: 'github.repos.createForOrg',
        err: err
      });
      return;
    }
  }

  // 3. Give the user access
  try {
    await octokit.request('PUT /repos/{owner}/{repo}/collaborators/{username}', {
      owner: 'cs240-illinois',
      repo: repoName,
      username: githubUserName,
      permission: 'push'
    })  
  } catch (err) {
    // Response: Unknown error and log it
    next({
      text: 'We recieved an unknown response from github.  Please try again later.',
      call: 'github.repos.addCollaborator',
      err: err
    });
    return;
  }

  resp.render('repoReady', data);
});

module.exports = router;
