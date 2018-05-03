var assert = require('assert');
var WebSite = require('../index').WebSite;
var path = require('path');
var fs = require('fs');

var edgercFile = '~/.edgerc';
var sectionName = 'papi';
var propertyId = 'prp_284816';
var propertyName = 'jenkins.base.property'; // Change this to your test property

// To run locally, set AKAMAI_TEST_HOST and AKAMAI_TEST_PROPID in your environment
// You must have a 'papi' section in your .edgerc file or use Akamai environment
// variables to set your credentials.  These credentials must be at the account
// level with read and write access in order to run these tests.
if (process.env.AKAMAI_TEST_HOST) {
  propertyName = process.env.AKAMAI_TEST_HOST;
}
if (process.env.AKAMAI_TEST_PROPID) {
  propertyId = process.env.AKAMAI_TEST_PROPID;
}

var akamaiweb = new WebSite({path: '~/.edgerc', section: 'papi'});

describe('Retrieve formats', function() {
  it('should retrieve the rules formats', function() {
    options = {};
    return akamaiweb.retrieveFormats()
      .then(data => {
        return akamaiweb.retrieveFormats(true);
      })
      .catch((error) => {
        assert(error);
      });
  });
  it('should retrieve groups', function() {
    return akamaiweb.retrieveGroups()
      .catch((error) => {
        assert(error);
      });
  });

  it('should search for a propertyname', function() {
    return akamaiweb.searchProperties('jenkins.base.property')
      .catch(error => {
        assert(error);
      });
  });

  it('should retrieve property hostnames', function() {
    let hostname = 'jenkins.base.property';
    return akamaiweb.retrieve(hostname, 0, true)
      .then(data => {
        assert(data.hostnames.items > 0);
      })
      .catch(error => {
        assert(error);
      });
  });
  it('should retrieve property variables', function() {
    let hostname = 'jenkins.base.property';
    return akamaiweb.getVariables(hostname)
      .then(() => {
        return akamaiweb.retrieve(hostname, 1, false);
      })
      .then(data => {
        assert(data.groupId == 'grp_77649');
      });
  });
});
