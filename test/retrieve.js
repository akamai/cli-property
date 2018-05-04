'use strict';
const assert = require('assert');
const WebSite = require('../index').WebSite;

let propertyName = 'jenkins.base.property';

// You must have a 'papi' section in your .edgerc file or use Akamai environment
// variables to set your credentials.  These credentials must be at the account
// level with read and write access in order to run these tests.
if (process.env.AKAMAI_TEST_HOST) {
  propertyName = process.env.AKAMAI_TEST_HOST;
}

const akamaiweb = new WebSite({path: '~/.edgerc', section: 'papi'});

describe('Retrieve formats', function() {
  it('should retrieve the rules formats', function() {
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
    return akamaiweb.searchProperties(propertyName)
      .catch(error => {
        assert(error);
      });
  });

  it('should retrieve property hostnames', function() {
    return akamaiweb.retrieve(propertyName, 0, true)
      .then(data => {
        assert(data.hostnames.items > 0);
      })
      .catch(error => {
        assert(error);
      });
  });
  it('should retrieve property variables', function() {
    return akamaiweb.getVariables(propertyName)
      .then(() => {
        return akamaiweb.retrieve(propertyName, 1, false);
      })
      .then(data => {
        assert(data.groupId == 'grp_77649');
      });
  });
});
