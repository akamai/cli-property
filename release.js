'use strict';
// No command line arguments, we're just going to use the env vars
const fs = require('fs');
const source = 'bin/akamaiProperty';
const target = 'akamai-property-1.0.2';
const exec = require('child-process-promise').exec;

exec(`pkg ${source} --target node7-linux-x86,node7-linux-x64,node7-win-x86,node7-win-x64,node7-macos-x64 --output ${target}`)
  .then(result => {
    console.error('stdout: ', result.stdout);
    console.error('stderr: ', result.stderr);
  })
  .then(() => {
    exec(`ls ${target}\*`)
      .then(result => {
        for (let filename of result.stdout.split('\n')) {
	        if (!filename) {
            continue;
          }
          const oldname = filename;
          filename = filename
            .replace('-win-', '-windows-')
            .replace('-x64', '-amd64')
            .replace('macos', 'mac')
            .replace('x86', '386');
          fs.renameSync(oldname, filename);
          require('child_process').execSync(`shasum -a 256 ${filename} | awk '{print $1}' > ${filename}.sig`);
        }
      })
      .catch(function(err) {
        console.error('ERROR: ', err);
      });
  });
