// build.js
// Very simple build script to run angular build
// Needed because all the cross platform things I tried didn't work

'use strict';

// No command line arguments, we're just going to use the env vars
const fs = require('fs');

const source = 'bin/akamaiProperty';
const target = 'akamai-property-1.0.3';

const exec = require('child-process-promise').exec;

exec(`pkg ${source} --target node8-linux-x86,node8-linux-x64,node8-win-x86,node8-win-x64,node8-macos-x64 --output ${target}`)
  .then(function(result) {
    const stdout = result.stdout;
    const stderr = result.stderr;
    console.log('stdout: ', stdout);
    console.log('stderr: ', stderr);
  })
  .then(() => {
    exec(`ls ${target}\*`)
      .then(result => {
        for (let filename of result.stdout.split('\n')) {
          if (!filename) { continue; }
          const oldname = filename;
          filename = filename.replace('-win-', '-windows-');
          filename = filename.replace('-x64', '-amd64');
          filename = filename.replace('macos', 'mac');
          filename = filename.replace('x86', '386');
          fs.renameSync(oldname, filename);
          require('child_process').execSync(`shasum -a 256 ${filename} | awk '{print $1}' > ${filename}.sig`);
        }
      })
      .catch(function(err) {
        console.error('ERROR: ', err);
      });
  });
