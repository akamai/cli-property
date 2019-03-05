var assert = require("assert");
var WebSite = require('../index').WebSite;
var exec = require('child-process-promise').exec;

var edgercFile = "~/.edgerc";
var sectionName = 'papi';
var propertyName = "jenkins.base.property"; // Change this to your test property
var propverToTest = 1; //change to available version on property

var versionsToTest = [
    "latest",
    "new",
    propverToTest
]; 

const optionsToTest = {
    "note": "Note from test",
    "addhosts" : "host1.test.com,host2.test.com",
    "delhosts" : "host1.test.com,host2.test.com",
    "cpcode" : "807127",
    "ruleFormat" : "v2018-02-27",
    "edgeHostName" : "ehn_3341748",
    "variables" : "test/configFiles/variables.js",
    "origin" : "test.origin.com",
    "forward" : "test.forward.com",
    "sureRouteMap" : "test.map",
    "sureRouteTo" : "test.to",
    "sureRouteToHost" : "test.to.host",
    "group" : "grp_102418"
};

// To run locally, set AKAMAI_TEST_HOST and AKAMAI_TEST_PROPID in your environment
// You must have a 'papi' section in your .edgerc file or use Akamai environment
// variables to set your credentials.  These credentials must be at the account
// level with read and write access in order to run these tests.
if (process.env.AKAMAI_TEST_HOST) {
    propertyName = process.env.AKAMAI_TEST_HOST;
}

var akamaiweb = new WebSite({path: edgercFile, section: sectionName});


describe('Modify property CLI', function () {

    let property;
    let nextPropertyVersion;
    before(function() {
        property = akamaiweb.retrieve(propertyName)
        .then(data => { 
            nextPropertyVersion = data.propertyVersion;
            return data;
        });
    });

    it('moves property to specified group', (done) => {
        exec(`node bin/akamaiProperty modify ${ propertyName } --move ${ optionsToTest.group }`)
        .then(response => {
            assert(response.stderr.includes(`Successfully moved ${ propertyName } to group ${ optionsToTest.group }`));
            done();
        }).catch(responseError => {
            assert(responseError.stdout.includes(`Unable to access user administration`));
            done();
        });
    });


    describe('New Version', function () {

        it('creates a new version from latest', (done) => {   
            property
            .then((data) => {
                exec(`node bin/akamaiProperty modify ${propertyName} --new`)
                .then(response => {
                    nextPropertyVersion++;
                    assert(response.stderr.includes(`Creating new version for ${ propertyName } from ${ data.propertyVersion }`));
                    assert(response.stderr.includes(`Created new version for (${ propertyName }) on v${ nextPropertyVersion }`));
                    done();
                }).catch(responseError => {
                    done(responseError);
                })
            });
        })
        it('creates a new version from --propver option', (done) => {
            let propver = 31;
            property
            .then((data) => {
                exec(`node bin/akamaiProperty modify ${ propertyName } --new --propver ${ propver }`)
                .then(response => {
                    nextPropertyVersion++;
                    assert(response.stderr.includes(`Creating new version for ${ propertyName } from ${ propver }`));
                    assert(response.stderr.includes(`Created new version for (${ propertyName }) on v${ nextPropertyVersion }`));
                    done();
                }).catch(responseError => {
                    done(responseError);
                })
            });
        });
    })

    versionsToTest.forEach(function(version){

        const versionText = version === "new" ? "new created version" : (version === "latest" ? "latest version" : `version ${version}`);

        describe(`runs options on ${ versionText }`, () => { 

            it('adds a note', function(done) {
                property
                .then((data) => {
                    exec(`node bin/akamaiProperty modify ${propertyName} ${ propertyName } ${ version === "new" ? "--new" : "" } ${ version !== "new" && version !== "latest" ? `--propver ${ version }` : "" } --notes ${ optionsToTest.note }`)
                    .then(response => {
                        if(version === "new"){
                            nextPropertyVersion++;
                        }
                        let versionToUpdate = (version === "new" || version === "latest") ? nextPropertyVersion : version;
                        assert(response.stdout.includes(`Updated note rules on v${ versionToUpdate }`));
                        done();
                    })
                    .catch(responseError => {
                        done(responseError);
                    })
                })
            });

            it('adds hosts', (done) => {
                property
                .then((data) => {
                    exec(`node bin/akamaiProperty modify ${ propertyName } ${ version === "new" ? "--new" : "" } ${ version !== "new" && version !== "latest" ? `--propver ${ version }` : "" } --addhosts ${ optionsToTest.addhosts }`)
                    .then(response => {
                        if(version === "new"){
                            nextPropertyVersion++;
                        }
                        let versionToUpdate = (version === "new" || version === "latest") ? nextPropertyVersion : version;
                        assert(response.stdout.includes(`Hostnames updated on v${ versionToUpdate }`));
                        done();
                    })
                    .catch(responseError => {
                        done(responseError);
                    })
                });
            });
            it('deletes hosts', (done) => {
                property
                .then((data) => {
                    exec(`node bin/akamaiProperty modify ${ propertyName } ${ version === "new" ? "--new" : "" } ${ version !== "new" && version !== "latest" ? `--propver ${ version }` : "" } --delhosts ${ optionsToTest.delhosts }`)
                    .then(response => {
                        if(version === "new"){
                            nextPropertyVersion++;
                        }
                        let versionToUpdate = (version === "new" || version === "latest") ? nextPropertyVersion : version;
                        assert(response.stdout.includes(`Hostnames updated on v${ versionToUpdate }`));
                        done();
                    })
                    .catch(responseError => {
                        done(responseError);
                    })
                });
            })
            it('modifies CPcode', (done) => {
                property
                .then((data) => {
                    exec(`node bin/akamaiProperty modify ${ propertyName } ${ version === "new" ? "--new" : "" } ${ version !== "new" && version !== "latest" ? `--propver ${ version }` : "" } --cpcode ${ optionsToTest.cpcode }`)
                    .then(response => {
                        if(version === "new"){
                            nextPropertyVersion++;
                        }
                        let versionToUpdate = (version === "new" || version === "latest") ? nextPropertyVersion : version;
                        assert(response.stdout.includes(`Updated CPcode rules on v${ versionToUpdate }`));
                        done();
                    })
                    .catch(responseError => {
                        done(responseError);
                    })
                });
            });
            it('modifies rule format', (done) => {
                property
                .then((data) => {
                    exec(`node bin/akamaiProperty modify ${ propertyName } ${ version === "new" ? "--new" : "" } ${ version !== "new" && version !== "latest" ? `--propver ${ version }` : "" } --ruleformat ${ optionsToTest.ruleFormat }`)
                    .then(response => {
                        if(version === "new"){
                            nextPropertyVersion++;
                        }
                        let versionToUpdate = (version === "new" || version === "latest") ? nextPropertyVersion : version;
                        assert(response.stdout.includes(`Updated Rule Format rules on v${ versionToUpdate }`));
                        done();
                    })
                    .catch(responseError => {
                        done(responseError);
                    })
                });
            })
            it('modifies edgehostname', (done) => {
                property
                .then((data) => {
                    exec(`node bin/akamaiProperty modify ${ propertyName } ${ version === "new" ? "--new" : "" } ${ version !== "new" && version !== "latest" ? `--propver ${ version }` : "" } --edgehostname ${ optionsToTest.edgeHostName }`)
                    .then(response => {
                        if(version === "new"){
                            nextPropertyVersion++;
                        }
                        let versionToUpdate = (version === "new" || version === "latest") ? nextPropertyVersion : version;
                        assert(response.stdout.includes(`Hostnames updated on v${ versionToUpdate }`));
                        done();
                    })
                    .catch(responseError => {
                        done(responseError);
                    })
                });
            });
            it('modifies sets variables', (done) => {
                property
                .then((data) => {
                    exec(`node bin/akamaiProperty modify ${ propertyName } ${ version === "new" ? "--new" : "" } ${ version !== "new" && version !== "latest" ? `--propver ${ version }` : "" } --variables ${ optionsToTest.variables }`)
                    .then(response => {
                        if(version === "new"){
                            nextPropertyVersion++;
                        }
                        let versionToUpdate = (version === "new" || version === "latest") ? nextPropertyVersion : version;
                        assert(response.stdout.includes(`Updated variables rules on v${ versionToUpdate }`));
                        done();
                    })
                    .catch(responseError => {
                        done(responseError);
                    })
                });
            });
            it('modifies origin/forward', (done) => {
                property
                .then((data) => {
                    exec(`node bin/akamaiProperty modify ${ propertyName } ${ version === "new" ? "--new" : "" } ${ version !== "new" && version !== "latest" ? `--propver ${ version }` : "" } --origin ${ optionsToTest.origin } --forward ${ optionsToTest.forward }`)
                    .then(response => {
                        if(version === "new"){
                            nextPropertyVersion++;
                        }
                        let versionToUpdate = (version === "new" || version === "latest") ? nextPropertyVersion : version;
                        assert(response.stdout.includes(`Updated Origin/Forward rules on v${ versionToUpdate }`));
                        done();
                    })
                    .catch(responseError => {
                        done(responseError);
                    })
                });
            });
            it('modifies sure route', (done) => {
                property
                .then((data) => {
                    exec(`node bin/akamaiProperty modify ${ propertyName } ${ version === "new" ? "--new" : "" } ${ version !== "new" && version !== "latest" ? `--propver ${ version }` : "" } --sureroutemap ${ optionsToTest.sureRouteMap } --sureroutero ${ optionsToTest.sureRouteTo } --sureroutetohost ${ optionsToTest.sureRouteToHost }`)
                    .then(response => {
                        if(version === "new"){
                            nextPropertyVersion++;
                        }
                        let versionToUpdate = (version === "new" || version === "latest") ? nextPropertyVersion : version;
                        assert(response.stdout.includes(`Updated Sure Route rules on v${ versionToUpdate }`));
                        done();
                    })
                    .catch(responseError => {
                        done(responseError);
                    })
                });
            });

            it('runs all options at once', (done) => {
                property
                .then((data) => {
                    exec(`node bin/akamaiProperty modify ${ propertyName } ${ version === "new" ? "--new" : "" } ${ version !== "new" && version !== "latest" ? `--propver ${ version }` : "" } --notes ${ optionsToTest.note } --cpcode ${ optionsToTest.cpcode } --addhosts ${ optionsToTest.addhosts } --delhosts ${ optionsToTest.delhosts } --edgehostname ${ optionsToTest.edgeHostName } --ruleformat ${ optionsToTest.ruleFormat } --forward ${ optionsToTest.forward } --origin ${ optionsToTest.origin } --variables ${ optionsToTest.variables } --sureroutemap ${ optionsToTest.sureRouteMap } --surerouteto ${ optionsToTest.sureRouteTo } --sureroutetohost ${ optionsToTest.sureRouteToHost }`)
                    .then(response => {
                        if(version === "new"){
                            nextPropertyVersion++;
                        }
                        let versionToUpdate = (version === "new" || version === "latest") ? nextPropertyVersion : version;
                        assert.equal(response.stdout.match(new RegExp('Hostnames updated on v' + versionToUpdate, 'g')).length, 3);
                        assert(response.stdout.includes(`Updated note rules on v${ versionToUpdate }`));
                        assert(response.stdout.includes(`Updated CPcode rules on v${ versionToUpdate }`));
                        assert(response.stdout.includes(`Updated Rule Format rules on v${ versionToUpdate }`));
                        assert(response.stdout.includes(`Updated variables rules on v${ versionToUpdate }`));
                        assert(response.stdout.includes(`Updated Origin/Forward rules on v${ versionToUpdate }`));
                        assert(response.stdout.includes(`Updated Sure Route rules on v${ versionToUpdate }`));
                        done();
                    })
                    .catch(responseError => {
                        done(responseError);
                    })
                });
            });
        })
    })
        
})
