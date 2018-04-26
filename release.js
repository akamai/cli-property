// build.js
// Very simple build script to run angular build
// Needed because all the cross platform things I tried didn't work

// No command line arguments, we're just going to use the env vars
let fs = require('fs')

let source = "bin/akamaiProperty"
let target = "akamai-property-1.0.2"

var exec = require('child-process-promise').exec;

exec(`pkg ${source} --target node7-linux-x86,node7-linux-x64,node7-win-x86,node7-win-x64,node7-macos-x64 --output ${target}`)
    .then(function (result) {
        let stdout = result.stdout
        ,   stderr = result.stderr;
        console.error('stdout: ', stdout);
        console.error('stderr: ', stderr);
    })
    .then(() => {
      exec(`ls ${target}\*`)
    .then(result => {
      for (let filename of result.stdout.split('\n')) {
	if (!filename) {continue}
        let oldname = filename
        filename =filename.replace('-win-','-windows-')
        filename =filename.replace('-x64','-amd64')
        filename =filename.replace('macos','mac')
        filename =filename.replace('x86','386')
        fs.renameSync(oldname, filename)
        require('child_process').execSync(`shasum -a 256 ${filename} | awk '{print $1}' > ${filename}.sig`)
      }    
    })
    .catch(function (err) {
        console.error('ERROR: ', err);
    })
  })
