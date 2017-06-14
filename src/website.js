// Copyright 2017 Akamai Technologies, Inc. All Rights Reserved
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
'use strict';

let EdgeGrid = require('edgegrid');
let untildify = require('untildify');
let md5 = require('md5');
let fs = require('fs');
let tmpDir = require('os').tmpdir();

//export
const LATEST_VERSION = {
    STAGING: -2,
    PRODUCTION: -1,
    LATEST: 0
};

//export
const AKAMAI_ENV = {
    STAGING: 'STAGING',
    PRODUCTION: 'PRODUCTION'
};

function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}

/**
 * WebSite configuration and manipulation. Use this class to control the workflow of your Akamai configuration for which
 * you normally would use the Property Manager apis.
 * @author Colin Bendell
 */

//export default class WebSite {
class WebSite {

    /**
     * Default constructor. By default the `~/.edgerc` file is used for authentication, using the `[default]` section.
     * @param auth {Object} providing the `path`, and `section` for the authentication. Alternatively, you can pass in
     *     `clientToken`, `clientSecret`, `accessToken`, and `host` directly.
     */
    constructor(auth = {path: "~/.edgerc",section: "default"}) {

        if (auth.clientToken && auth.clientSecret && auth.accessToken && auth.host)
            this._edge = new EdgeGrid(auth.clientToken, auth.clientSecret, auth.accessToken, auth.host, auth.debug);
        else
            this._edge = new EdgeGrid({
                path: untildify(auth.path),
                section: auth.section,
                debug: auth.debug
            });
        this._propertyById = {};
        this._propertyByName = {};
        this._propertyByHost = {};
        this._initComplete = false;
        this._propertyHostnameList = {};
        this._ehnByHostname = {};
        if (auth.create) {
            this._initComplete = true;
        }
    }

    _init() {
        if (this._initComplete)
            return Promise.resolve();
        if (Object.keys(this._propertyById).length > 0) {
            this._initComplete = true;
            return Promise.resolve();
        }

        let groupcontractList = [];
        console.time('Init PropertyManager cache');
        console.info('Init PropertyManager cache (hostnames and property list)');
        return this._getGroupList()
            .then(data => {
                return new Promise((resolve, reject) => {
                    return resolve(data);
                })
            })
            .then(data => {
                this._propertyHostnameList = data.propertyHostnameList || {};
                if (data.groups && data.groups.items)
                    data.groups.items.map(item => {
                        if (item.contractIds)
                            item.contractIds.map(contractId => {
                                // if we have filtered out the contract and group already through the constructor, limit the list appropriately
                                //TODO: clean this logic
                                if ((!this._groupId || this._groupId === item.groupId) && (!this._contractId || this._contractId === contractId))
                                    groupcontractList.push({
                                        contractId: contractId,
                                        groupId: item.groupId
                                    });
                            });
                    });
                // get the  list of all properties for the known list of contracts and groups now
                console.info('... retrieving properties from %s groups', groupcontractList.length);
                return Promise.all(groupcontractList.map(v => {
                    return this._getPropertyList(v.contractId, v.groupId);
                }));
            })
            .then(propList => {
                let promiseList = [];

                propList.map(v => {
                    if (!v || !v.properties || !v.properties.items) return;
                    return v.properties.items.map(item => {
                        let letters = "/^[0-9a-zA-Z\\_\\-\\.]+$/";
                        let configName = item.propertyName;
                        if (!configName.match(letters)) {
                            configName = configName.replace(/[^0-9a-zA-Z\\_\\-\\.]/gi, '_')
                        }
                        item.propertyName = configName;
                        //TODO: should use toJSON() instead of the primitive toString()
                        item.toString = function () {
                            return this.propertyName;
                        };
                        this._propertyByName[item.propertyName] = item;
                        this._propertyById[item.propertyId] = item;
                        if (item.productionVersion != null)
                            promiseList.push(this._getHostnameList(item.propertyId, item.productionVersion));
                        if (item.productionVersion && item.productionVersion != item.stagingVersion)
                            promiseList.push(this._getHostnameList(item.propertyId, item.stagingVersion));
                        if (item.productionVersion == null)
                            promiseList.push(this._getHostnameList(item.propertyId, item.latestVersion))
                    });
                });

                console.info('... retrieving Hosts from %s properties', Object.keys(this._propertyById).length);
                return Promise.all(promiseList);
            })
            .then(hostListList => {
                hostListList.map(hostList => {
                    if (!hostList || !hostList.propertyId || !hostList.propertyVersion) {
                        console.log("ignoring: ", hostList);
                        return;
                    }
                    let prop = this._propertyById[hostList.propertyId];
                    let version = hostList.propertyVersion;
                    if (prop.latestVersion != version ||
                        prop.latestVersion == prop.stagingVersion ||
                        prop.latestVersion == prop.productionVersion) {
                        if (!this._propertyHostnameList[hostList.propertyId]) {
                            this._propertyHostnameList[hostList.propertyId] = {}
                        }
                        this._propertyHostnameList[hostList.propertyId][version] = hostList;
                    }

                    if (prop.latestVersion && prop.latestVersion === hostList.propertyVersion)
                        prop.latestHosts = hostList.hostnames.items;
                    if (prop.stagingVersion && prop.stagingVersion === hostList.propertyVersion)
                        prop.stagingHosts = hostList.hostnames.items;
                    if (prop.productionVersion && prop.productionVersion === hostList.propertyVersion)
                        prop.productionHosts = hostList.hostnames.items;

                    hostList.hostnames.items.map(host => {
                        let hostRef = this._propertyByHost[host.cnameFrom];
                        if (!hostRef)
                            hostRef = this._propertyByHost[host.cnameFrom] = {};
                        this._ehnByHostname[host.cnameTo] = host.edgeHostnameId;

                        if (prop.stagingVersion && prop.stagingVersion === hostList.propertyVersion)
                            hostRef.staging = prop;
                        if (prop.productionVersion && prop.productionVersion === hostList.propertyVersion)
                            hostRef.production = prop;
                    })
                });
                console.timeEnd('Init PropertyManager cache');
            });
    };

    _getNewProperty(propertyId, groupId, contractId) {
        return new Promise((resolve, reject) => {
            //console.info('... retrieving list of properties {%s : %s}', contractId, groupId);

            let request = {
                method: 'GET',
                path: `/papi/v0/properties/${propertyId}?contractId=${contractId}&groupId=${groupId}`,
            };
            this._edge.auth(request);

            this._edge.send(function (data, response) {
                if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else if (response && response.statusCode == 403) {
                    console.info('... your client credentials have no access to this group, skipping {%s : %s}', contractId, groupId);
                    resolve(null);
                } else {
                    reject(response);
                }
            });
        });
    }

    _getCloneConfig(srcProperty, srcVersion = LATEST_VERSION.STAGING) {
        let cloneFrom = {};
        let contractId,
            groupId,
            productId,
            edgeHostnameId;

        return this._getProperty(srcProperty, srcVersion)
            .then(cloneFromProperty => {
                contractId = cloneFromProperty.contractId;
                groupId = cloneFromProperty.groupId;

                let productionHosts = cloneFromProperty.productionHosts;
                let stagingHosts = cloneFromProperty.stagingHosts;
                let latestHosts = cloneFromProperty.latestHosts;

                let hosts = productionHosts || stagingHosts || latestHosts;

                if (hosts) {
                    edgeHostnameId = hosts[0]["edgeHostnameId"];
                    if (!edgeHostnameId) {
                        edgeHostnameId = hosts[0]["cnameTo"];
                    }
                }

                cloneFrom = {propertyId: cloneFromProperty.propertyId,
                             groupId: groupId,
                             contractId: contractId,
                             edgeHostnameId: edgeHostnameId};
                return WebSite._getLatestVersion(cloneFromProperty)
            })
            .then(version => {
                cloneFrom.version = version;
                return new Promise((resolve, reject) => {
                    console.info('... retrieving clone info');

                    let request = {
                        method: 'GET',
                        path: `/papi/v0/properties/${cloneFrom.propertyId}/versions/${cloneFrom.version}?contractId=${contractId}&groupId=${groupId}`,
                        followRedirect: false
                    };
                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (response && response.statusCode >= 200 && response.statusCode < 400) {
                            let parsed = JSON.parse(response.body);
                            cloneFrom.cloneFromVersionEtag = parsed.versions.items[0]["etag"];
                            cloneFrom.productId = parsed.versions.items[0]["productId"];
                            resolve(cloneFrom);
                        } else {
                            reject(response);
                        }
                    });
                })
            })
            .then(cloneFrom => {
                console.info('... retrieving clone rules for cpcode')
                return new Promise ((resolve, reject) => {
                    let request = {
                            method: 'GET',
                            path: `/papi/v0/properties/${cloneFrom.propertyId}/versions/${cloneFrom.version}/rules?contractId=${contractId}&groupId=${groupId}`,
                            followRedirect: false
                        };
                        this._edge.auth(request);

                        this._edge.send(function (data, response) {
                            if (response && response.statusCode >= 200 && response.statusCode < 400) {
                                let parsed = JSON.parse(response.body);
                                cloneFrom.rules = parsed;
                                resolve(cloneFrom);
                            } else {
                                reject(response);
                            }
                        });
                    })
            }).then(cloneFrom => {
                cloneFrom.rules.rules.behaviors.map(behavior => {
                    if (behavior.name == "cpCode") {
                        cloneFrom.cpcode = behavior.options.value.id
                    }
                })
                return Promise.resolve(cloneFrom);
            })
    };

    _getGroupList(fallThrough=false) {
        return new Promise((resolve, reject) => {
            console.info('... retrieving list of Group Ids');

            let request = {
                method: 'GET',
                path: '/papi/v0/groups',
                followRedirect: false,
                followAllRedirects: false
            };
            this._edge.auth(request);

            this._edge.send(function (data, response) {
                if (!response && fallThrough) {
                     console.log("... No response from server for groups")
                     reject();
                } else if (!response) {
                    console.log("Grabbing groups again")
                      return this._getGroupList(1)
                } else if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else {
                    reject(response);
                }
            });
        });
    };

    //TODO: this will only be called for LATEST, CURRENT_PROD and CURRENT_STAGE. How do we handle collecting hostnames of different versions?
    _getHostnameList(propertyId, version, newConfig=false, fallThrough=false) {
        if (newConfig) {
            return Promise.resolve();
        }
        
        return this._getProperty(propertyId)
            .then(property => {
                //set basic data like contract & group
                const contractId = property.contractId;
                const groupId = property.groupId;
                const propertyId = property.propertyId;
                let Website = this;

                return new Promise((resolve, reject) => {
                    //console.info('... retrieving list of hostnames {%s : %s : %s}', contractId, groupId, propertyId);
                    if (version == null || !version) {
                        version = 1;
                    }
                    if (this._propertyHostnameList &&
                        this._propertyHostnameList[propertyId] &&
                        this._propertyHostnameList[propertyId][version]) {
                        resolve(this._propertyHostnameList[propertyId][version]);
                    } else {
                        let request = {
                            method: 'GET',
                            path: `/papi/v0/properties/${propertyId}/versions/${version}/hostnames/?contractId=${contractId}&groupId=${groupId}`,
                            followRedirect: false
                        };
                        this._edge.auth(request);
                        
                        this._edge.send(function (data, response) {
                            if ((response == false) || (response == undefined)) {
                                console.log("... No response from server for " + propertyId + ", skipping")
                                resolve(propertyId);
                            } 
                            if (response && response.body && response.statusCode >= 200 && response.statusCode < 400) {
                                let parsed = JSON.parse(response.body);
                                resolve(parsed);
                            } else if (response && response.statusCode == 500) {
                                // Work around PAPI bug
                                console.log("... Error from server for " + propertyId)
                                resolve(propertyId);
                            } else {
                                console.log(response)
                                reject(response);
                            }
                        })
                    }
                });
            });
    };

    _getMainProduct(groupId, contractId) {
        let productInfo;
        return new Promise((resolve, reject) => {
            console.info('... retrieving list of Products for this contract');
            let request = {
                method: 'GET',
                path: `/papi/v0/products?contractId=${contractId}&groupId=${groupId}`,
                followRedirect: false,
                followAllRedirects: false
            };
            this._edge.auth(request);

            this._edge.send(function (data, response) {
                if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    parsed.products.items.map(item => {
                        if (item.productId == "prd_SPM") {
                            productInfo = {
                                productId: "prd_SPM",
                                productName: "SPM",
                                groupId: groupId,
                                contractId: contractId
                           };
                            resolve(productInfo);
                        } else if (item.productId == "prd_Dynamic_Site_Del") {
                            productInfo = {
                                productId: "prd_Dynamic_Site_Del",
                                productName: "Dynamic_Site_Del",
                                groupId: groupId,
                                contractId: contractId
                            }
                            resolve(productInfo);
                        }
                    });
                } else if (response.statusCode == 403) {
                    console.info('... your credentials do not have permission for this group, skipping  {%s : %s}', contractId, groupId);
                    resolve(null);
                } else {
                    reject(response);
                }
                resolve(productInfo);
            });
        });
    };

    _getProperty(propertyLookup, hostnameEnvironment = LATEST_VERSION.STAGING) {
        if (propertyLookup && propertyLookup.groupId && propertyLookup.propertyId && propertyLookup.contractId)
            return Promise.resolve(propertyLookup);
        propertyLookup = propertyLookup.replace(/[^0-9a-zA-Z\\_\\-\\.]/gi, '_');
        return this._init()
            .then(() => {
                let prop = this._propertyById[propertyLookup] || this._propertyByName[propertyLookup];
                if (!prop) {
                    let host = this._propertyByHost[propertyLookup];
                    if (host)
                        prop = hostnameEnvironment === LATEST_VERSION.STAGING ? host.staging : host.production;
                }

                if (!prop)
                    return Promise.reject(Error(`Cannot find property: ${propertyLookup}`));
                return Promise.resolve(prop);
            });
    };

    _getPropertyList(contractId, groupId, fallThrough=false) {
        return new Promise((resolve, reject) => {
            //console.info('... retrieving list of properties {%s : %s}', contractId, groupId);

            let request = {
                method: 'GET',
                path: `/papi/v0/properties?contractId=${contractId}&groupId=${groupId}`,
            };
            this._edge.auth(request);

            this._edge.send(function (data, response) {
                if (!response && fallThrough) {
                     console.log("... No response from server for property list")
                        resolve(propertyId);
                } else if (!response) {
                      return this._getPropertyList(contractId, groupId, 1)
                } else if (response && response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else if (response.statusCode == 403) {
                    console.info('... no permissions, ignoring  {%s : %s}', contractId, groupId);
                    resolve(null);
                } else {
                    reject(response);
                }
            });
        });
    };

    _getPropertyRules(propertyLookup, version, fallThrough=false) {
        return this._getProperty(propertyLookup)
            .then((data) => {
                //set basic data like contract & group
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;

                return new Promise((resolve, reject) => {
                    console.time('... retrieving');
                    console.info(`... retrieving property (${propertyLookup}) v${version}`);
                    //console.info('... retrieving list of hostnames {%s : %s : %s}', contractId, groupId, propertyId);
                    if (version == null) {
                        version = 1;
                    }

                    let request = {
                        method: 'GET',
                        path: `/papi/v0/properties/${propertyId}/versions/${version}/rules?contractId=${contractId}&groupId=${groupId}`,
                        followRedirect: false
                    };
                    this._edge.auth(request);

                    this._edge.send(function (data, response) {

                        if (!response && fallThrough) {
                            reject("No response from server.  Please retry.");
                        } else if (!response) {
                            return this._getPropertyRules(propertyLookup, version, 1)
                        }
                        console.timeEnd('... retrieving');
                        if (response && response.statusCode >= 200 && response.statusCode < 400) {
                            let parsed = JSON.parse(response.body);
                            resolve(parsed);
                        } else {
                            reject(response);
                        }
                    })
                })
            });
    }

    static _getLatestVersion(property, env = LATEST_VERSION) {
        if (env === LATEST_VERSION.PRODUCTION)
            return property.productionVersion;
        else if (env === LATEST_VERSION.STAGING)
            return property.stagingVersion;
        else if (property.latestVersion)
            return property.latestVersion;
        else
            return 1;
    };

    _copyPropertyVersion(propertyLookup, versionId) {
        return this._getProperty(propertyLookup)
            .then((data) => {
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;
                return new Promise((resolve, reject) => {
                    console.time('... copy');
                    console.info(`... copy property (${propertyLookup}) v${versionId}`);
                    let body = {};
                    body.createFromVersion = versionId;

                    let request = {
                        method: 'POST',
                        path: `/papi/v0/properties/${propertyId}/versions?contractId=${contractId}&groupId=${groupId}`,
                        body: body
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        console.timeEnd('... copy');
                        if (/application\/json/.test(response.headers['content-type'])) {
                            let parsed = JSON.parse(response.body);
                            let matches = !parsed.versionLink ? null : parsed.versionLink.match('versions/(\\d+)?');
                            if (!matches) {
                                reject(Error('cannot find version'));
                            } else {
                                resolve(matches[1]);
                            }
                        } else if (response.statusCode === 404) {
                            resolve({});
                        } else {
                            reject(response);
                        }
                    });
                });
            });
    };

    _createProperty(groupId, contractId, configName, productId, cloneFrom = null) {
        return new Promise((resolve, reject) => {
            console.time('... creating');
            console.info(`Creating property config ${configName}`);

            if (cloneFrom) {
                productId = cloneFrom.productId;
            }

            let propertyObj = {
                "cloneFrom": cloneFrom,
                "productId": productId,
                "propertyName": configName
            };

            let request = {
                method: 'POST',
                path: `/papi/v0/properties/?contractId=${contractId}&groupId=${groupId}`,
                body: propertyObj
            };

            this._edge.auth(request);

            this._edge.send(function (data, response) {
                console.timeEnd('... creating');
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    let propertyResponse = JSON.parse(response.body);
                    response = propertyResponse["propertyLink"].split('?')[0].split("/")[4];
                    resolve(response);
                } else {
                    reject(response);
                }
            });
        })
    }

    _updatePropertyBehaviors(rules, configName, hostname, cpcode, origin=null, secure=false) {
        return new Promise((resolve, reject) => {
            let behaviors = [];
            let children_behaviors = [];

            rules.rules.behaviors.map(behavior => {
                if (behavior.name == "origin" && origin) {
                    behavior.options.hostname = origin;
                }
                if (behavior.name == "cpCode") {
                    if (behavior.options.value) {
                        behavior.options.value = {"id":Number(cpcode)};
                    } else {
                        behavior.options.cpcode = {"id":Number(cpcode)};
                    }
                }
                behaviors.push(behavior);
            })
            rules.rules.behaviors = behaviors;

            rules.rules.children.map(child => {
                child.behaviors.map(behavior => {
                    if (behavior.name == "sureRoute") {
                        if (!behavior.options.sr_stat_key_mode && !behavior.options.testObjectUrl) {
                            behavior.options.sr_stat_key_mode = "default";
                            behavior.options.sr_test_object_url = "/akamai/sureroute-testobject.html"
                        }
                    }
                    children_behaviors.push(behavior);
                })
            })
            if (secure) {
                rules.rules.options = {"is_secure":true}
            }
            rules.rules.children.behaviors = children_behaviors;

            delete rules.errors;
            resolve(rules);
        })
    }

    _updatePropertyRules(propertyLookup, version, rules) {
        return this._getProperty(propertyLookup)
            .then((data) => {
                //set basic data like contract & group
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;
                return new Promise((resolve, reject) => {
                    console.time('... updating');
                    console.info(`... updating property (${propertyLookup}) v${version}`);

                    let request = {
                        method: 'PUT',
                        path: `/papi/v0/properties/${propertyId}/versions/${version}/rules?contractId=${contractId}&groupId=${groupId}`,
                        body: rules
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        console.timeEnd('... updating');
                        if (response.statusCode >= 200 && response.statusCode < 400) {
                            let newRules = JSON.parse(response.body);
                            resolve(newRules);
                        } else {
                            reject(response);
                        }
                    });
                });
            });
    };

    _createCPCode(groupId, contractId, productId, configName) {
        return new Promise((resolve, reject) => {
            console.info('Creating new CPCode for property');
            console.time('... creating new CPCode');
            let cpCode = {
                "productId": productId,
                "cpcodeName": configName
            };
            let request = {
                method: 'POST',
                path: `/papi/v0/cpcodes?contractId=${contractId}&groupId=${groupId}`,
                body: cpCode
            };

            this._edge.auth(request);

            this._edge.send((data, response) => {
                console.timeEnd('... creating new CPCode');
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    let cpcode = parsed["cpcodeLink"].split('?')[0].split("/")[4].split('_')[1];
                    resolve(cpcode);
                } else {
                    console.log("Unable to create new cpcode.  Likely this means you have reached the limit of new cpcodes for this contract.  Please try the request again with a specified cpcode");
                    resolve();
                }
            });
        });
    }

    //TODO: should only return one edgesuite host name, even if multiple are called - should lookup to see if there is alrady an existing association
    _createHostname(groupId, contractId, configName, productId, edgeHostnameId=null, force=false, secure=false) {
        if (edgeHostnameId) {
            return Promise.resolve(edgeHostnameId);
        }
        return this._getEdgeHostnames(groupId, contractId)
            .then(edgeHostnames => {
                let edgeHostnameId = "";
                edgeHostnames.edgeHostnames.items.map(item => {
                    if (item["domainPrefix"] === configName) {
                        console.info("Hostname already exists");
                        edgeHostnameId = item["edgeHostnameId"]
                        if (this._propertyByHost[item["domainPrefix"]] ) {
                            let property = this._propertyByHost[item["domainPrefix"]]
                            console.info("Hostname assigned to " + property["propertyName"])
                        }
                        return Promise.resolve(edgeHostnameId);
                    }
                });
                return Promise.resolve(edgeHostnameId);
            })
            .then(edgeHostnameId => {
                if (edgeHostnameId) {
                    return Promise.resolve(edgeHostnameId);
                } else {
                    return new Promise((resolve, reject) => {
                        let ehnGroupCounts = {};
                        let ehnContractCounts = {};
                        let ehnSecureContractCounts = {};
                        let ehnSecureGroupCounts = {};
                        let propertyByHost = this._propertyByHost;
                        Object.keys(propertyByHost).forEach(function(key) {
                            let current = propertyByHost[key]["production"] || propertyByHost[key]["staging"]
                            if (current) {
                                let hosts = [];
                                if (current["productionHosts"]) {
                                    hosts.push.apply(hosts, current["productionHosts"])
                                }
                                if (current["stagingHosts"]) {
                                    hosts.push.apply(hosts, current["stagingHosts"]);
                                }
                                if (current.contractId == contractId) {
                                    hosts.forEach(function(host) {
                                        if (!ehnContractCounts[host.edgeHostnameId]) {
                                               if(host.cnameTo.indexOf("edgekey") > -1) {
                                                    ehnSecureContractCounts[host.edgeHostnameId] = 1;
                                               } else {
                                                   ehnContractCounts[host.edgeHostnameId] = 1;
                                               }
                                            } else {
                                                if(host.cnameTo.indexOf("edgekey") > -1) {
                                                    ehnContractCounts[host.edgeHostnameId] += 1;
                                                } else {
                                                    ehnSecureContractCounts[host.edgeHostnameId] += 1;
                                                }
                                            }

                                        if (current.groupId == groupId) {
                                            if (!ehnGroupCounts[host.edgeHostnameId]) {
                                                ehnGroupCounts[host.edgeHostnameId] = 1;
                                            } else {
                                                ehnGroupCounts[host.edgeHostnameId] += 1;
                                            }
                                        }
                                    })
                                }
                            }
                        })
                        let groupSorted = Object.keys(ehnGroupCounts).sort((a,b) => ehnGroupCounts[a]-ehnGroupCounts[b])
                        let contractSorted = Object.keys(ehnContractCounts).sort((a,b) => ehnContractCounts[b]-ehnContractCounts[a])

                        if (groupSorted.length > 0) {
                            let edgeHostnameId = groupSorted[0];
                            resolve(edgeHostnameId);
                        } else {
                            let edgeHostnameId = contractSorted[0];
                            resolve(edgeHostnameId)
                        }
                        resolve();
                    })
                }
            })
            .then(edgeHostnameId => {
                return new Promise((resolve, reject) => {
                    if (edgeHostnameId) {
                        resolve(edgeHostnameId);
                    } else {
                        console.info('Creating edge hostname for property: ' + configName);
                        console.time('... creating hostname');
                        let hostnameObj = {
                            "productId": productId,
                            "domainPrefix": configName,
                            "domainSuffix": "edgesuite.net",
                            "secure": false,
                            "ipVersionBehavior": "IPV6_COMPLIANCE",
                        };

                        let request = {
                            method: 'POST',
                            path: `/papi/v0/edgehostnames?contractId=${contractId}&groupId=${groupId}`,
                            body: hostnameObj
                        };

                        this._edge.auth(request);

                        this._edge.send((data, response) => {
                            console.timeEnd('... creating hostname');
                            if (response.statusCode >= 200 && response.statusCode < 400) {
                                let hostnameResponse = JSON.parse(response.body);
                                response = hostnameResponse["edgeHostnameLink"].split('?')[0].split("/")[4];
                                resolve(response);
                            } else {
                                reject(response);
                            }
                        })
                    }
                })
            })
    }

    /**
     * Internal function to activate a property
     *
     * @param propertyLookup
     * @param versionId
     * @param env
     * @param notes
     * @param email
     * @param acknowledgeWarnings
     * @param autoAcceptWarnings
     * @returns {Promise.<TResult>}
     * @private
     */
    _activateProperty(propertyLookup, versionId, env = LATEST_VERSION.STAGING, notes = '', email = ['test@example.com'], acknowledgeWarnings = [], autoAcceptWarnings = true) {
        return this._getProperty(propertyLookup)
            .then((data) => {
                //set basic data like contract & group
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;
                return new Promise((resolve, reject) => {
                    console.time('... activating');
                    console.info(`... activating property (${propertyLookup}) v${versionId} on ${env}`);

                    let activationData = {
                        propertyVersion: versionId,
                        network: env,
                        note: notes,
                        notifyEmails: email,
                        acknowledgeWarnings: acknowledgeWarnings,
                        complianceRecord: {
                            noncomplianceReason: 'NO_PRODUCTION_TRAFFIC'
                        }
                    };
                    let request = {
                        method: 'POST',
                        path: `/papi/v0/properties/${propertyId}/activations?contractId=${contractId}&groupId=${groupId}`,
                        body: activationData
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (response.statusCode >= 200 && response.statusCode <= 400) {
                            let parsed = JSON.parse(response.body);
                            resolve(parsed);
                        } else {
                            reject(response.body);
                        }
                    });
                });
            })
            .then(body => {
                console.timeEnd('... activating');
                if (body.type && body.type.includes('warnings-not-acknowledged')) {
                    let messages = [];
                    console.info('... automatically acknowledging %s warnings!', body.warnings.length);
                    body.warnings.map(warning => {
                        console.info('Warnings: %s', warning.detail);
                        //TODO report these warnings?
                        //console.trace(body.warnings[i]);
                        messages.push(warning.messageId);
                    });
                    //TODO: check that this doesn't happen more than once...
                    return this._activateProperty(propertyLookup, versionId, env, notes, email, messages);
                } else
                //TODO what about errors?
                    return new Promise((resolve, reject) => {
                        //TODO: chaise redirect?
                        console.time('Activation Time');
                        let matches = !body.activationLink ? null : body.activationLink.match('activations/([a-z0-9_]+)\\b');

                        if (!matches) {
                            reject(body);
                        } else {
                            resolve(matches[1])
                        }
                    });
            });
    };

    //POST /platformtoolkit/service/properties/deActivate.json?accountId=B-C-1FRYVMN&aid=10357352&gid=64867&v=12
    //{"complianceRecord":{'unitTested":false,"peerReviewedBy":"","customerEmail":"","nonComplianceReason":"NO_PRODUCTION","otherNoncomplianceReason":"","siebelCase":""},"emailList":"colinb@akamai.com","network":"PRODUCTION","notes":"","notificationType":"FINISHED","signedOffWarnings":[]}

    _deactivateProperty(propertyLookup, versionId, env = LATEST_VERSION.STAGING, notes = '', email = ['test@example.com']) {
        return this._getProperty(propertyLookup)
            .then((data) => {
                //set basic data like contract & group
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;
                return new Promise((resolve, reject) => {
                    console.time('... deactivating');
                    console.info(`... deactivating property (${propertyLookup}) v${versionId} on ${env}`);

                    let activationData = {
                        propertyVersion: versionId,
                        network: env,
                        notifyEmails: email,
                        activationType: "DEACTIVATE",
                        complianceRecord: {
                            noncomplianceReason: 'NO_PRODUCTION_TRAFFIC'
                        }

                    };
                    let request = {
                        method: 'POST',
                        path: `/papi/v0/properties/${propertyId}/activations?contractId=${contractId}&groupId=${groupId}`,
                        body: activationData
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (!response) {
                            reject();
                        }
                        if (response.statusCode >= 200 && response.statusCode <= 400) {
                            let parsed = JSON.parse(response.body);
                            let matches = !parsed.activationLink ? null : parsed.activationLink.match('activations/([a-z0-9_]+)\\b');

                            if (!matches) {
                                reject(parsed);
                            } else {
                                resolve(matches[1])
                            }
                        } else if (response.statusCode == '500' && response.body.match('https://problems.luna.akamaiapis.net/papi/v0/toolkit/property_version_not_active_in')){
                            console.log("Version not active on " + env)
                            resolve();
                      } else {
                            reject(response.body);
                        }
                    });
                });
            })
    }

    _pollActivation(propertyLookup, activationID) {
        return this._getProperty(propertyLookup)
            .then(data => {
                //set basic data like contract & group
                const contractId = data.contractId;
                const groupId = data.groupId;
                const propertyId = data.propertyId;
                return new Promise((resolve, reject) => {

                    let request = {
                        method: 'GET',
                        path: `/papi/v0/properties/${propertyId}/activations/${activationID}?contractId=${contractId}&groupId=${groupId}`,
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (response.statusCode === 200 && /application\/json/.test(response.headers['content-type'])) {
                            let parsed = JSON.parse(response.body);
                            resolve(parsed);
                        }
                        if (response.statusCode === 500) {
                            console.error('Activation caused a 500 response. Retrying...')
                            resolve({
                                activations: {
                                    items: [{
                                        status: 'PENDING'
                                    }]
                                }
                            });
                        } else {
                            reject(response);
                        }
                    });
                })
            })
            .then(data => {
                let pending = false;
                let active = false;
                data.activations.items.map(status => {
                    pending = pending || 'ACTIVE' != status.status;
                    active = !pending && 'ACTIVE' === status.status;
                });
                if (pending) {
                    console.info('... waiting 30s');
                    return sleep(30000).then(() => {
                        return this._pollActivation(propertyLookup, activationID);
                    });
                } else {
                    return active ? Promise.resolve(true) : Promise.reject(data);
                }

            });
    };

    _getAssetIds(accountId, groupId) {
        return new Promise((resolve, reject) => {
            console.info('Gathering asset ID for property');
            console.time('... requesting');

            let request = {
                method: 'GET',
                path: `/user-admin/v1/accounts/${accountId}/groups/${groupId}/properties`
            };

            this._edge.auth(request);

            this._edge.send((data, response) => {
                console.timeEnd('... requesting');
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    let parsed = JSON.parse(response.body);
                    resolve(parsed);
                } else {
                    reject("Unable to access user administration.  Please ensure your credentials allow user admin access.");
                }
            });
        });
    }


    _moveProperty(propertyLookup, destGroup, fallThrough=false) {
        let sourceGroup, propertyId, accountId, propertyName;

        console.time('... moving property');
        if (destGroup.match("grp_")) {
            destGroup = destGroup.substring(4);
        }

        return this._getProperty(propertyLookup)
            .then(data => {
                // User admin API uses non-PAPI strings
                // Turning grp_12345 into 12345, for
                // Group, property and account
                sourceGroup = Number(data.groupId.substring(4));
                propertyId = data.propertyId.substring(4);
                accountId = data.accountId.substring(4);
                destGroup = Number(destGroup);
                propertyName = data.propertyName;
                return this._getAssetIds(accountId, sourceGroup)
        })
        .then(assetIds => {
            let assetId;
            for (let entry of assetIds) {
                if (entry.assetName == propertyName) {
                    assetId = entry.assetId;
                }
            }

            if (!assetId) {
                reject("No matching property found");
            }
                return new Promise((resolve, reject) => {
                    let moveData = {
                        "sourceGroupId":sourceGroup,
                        "destinationGroupId":destGroup
                    }

                    let request = {
                                    method: 'PUT',
                                    path: `/user-admin/v1/accounts/${accountId}/properties/${assetId}`,
                                    body: moveData
                    };

                    this._edge.auth(request);

                    this._edge.send(function (data, response) {
                        if (!response && fallthrough) {
                            reject();
                        } else if (!response) {
                            return this._moveProperty(propertyLookup, destGroup,1);
                        } else if (response.statusCode == 204) {
                            console.log("Successfully moved " + propertyName + " to group " + destGroup)
                            resolve();
                        } else if (response.statusCode >= 200 && response.statusCode <= 400) {
                            resolve(response.body);
                        } else {
                            reject(response.body);
                        }
                    })
                })
        });
    }

    _deleteConfig(property) {
        return new Promise((resolve, reject) => {
            console.time('... deleting property');
            let request = {
                method: 'DELETE',
                path: `/papi/v0/properties/${property.propertyId}?contractId=${property.contractId}&groupId=${property.groupId}`
            }
            this._edge.auth(request);
            this._edge.send((data, response) => {
                console.timeEnd('... deleting property');
                let parsed = JSON.parse(response.body);
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    resolve(parsed);
                } else {
                    reject(parsed);
                }
            })
        })
    }

    _assignHostnames(groupId, contractId, configName, edgeHostnameId, propertyId, hostnames, deleteHosts=false, newConfig=false) {
        let assignHostnameArray,myDelete=false;
        let newHostnameArray = [];
        return this._getHostnameList(configName, LATEST_VERSION.LATEST,newConfig)
        .then(hostnamelist => {
            if (hostnamelist) {
                assignHostnameArray = hostnamelist.hostnames.items;
            } else {
                assignHostnameArray = [];
            }
            let property = this._propertyById[propertyId];
            let version = property.latestVersion;

            return new Promise((resolve, reject) => {
                console.info('Updating property hostnames');
                console.time('... updating hostname');

                if (hostnames.length == 0) {
                    hostnames = [configName];
                }

                if (!deleteHosts) {
                    newHostnameArray = assignHostnameArray;
                    hostnames.map(hostname => {
                        let assignHostnameObj;
                        if (edgeHostnameId.includes("ehn_")) {
                            assignHostnameObj = {
                                "cnameType": "EDGE_HOSTNAME",
                                "edgeHostnameId": edgeHostnameId,
                                "cnameFrom": hostname
                            }
                        } else {
                             assignHostnameObj = {
                                "cnameType": "EDGE_HOSTNAME",
                                "cnameTo": edgeHostnameId,
                                "cnameFrom": hostname
                            }
                        }

                        console.log("Adding hostname " + assignHostnameObj["cnameFrom"]);
                        newHostnameArray.push(assignHostnameObj);
                    })
                } else {
                    assignHostnameArray.map(host=> {
                        myDelete = false;
                        for (let i=0; i<hostnames.length; i++) {
                            if (hostnames[i] == host["cnameFrom"]) {
                                myDelete = true;
                                console.log("Removing hostname " + host["cnameFrom"]);
                            }
                        }
                        if (!myDelete) {
                            newHostnameArray.push(host);
                            console.log("Not removing hostname " + host["cnameFrom"]);
                        }
                    })
                }

                let request = {
                    method: 'PUT',
                    path: `/papi/v0/properties/${propertyId}/versions/${version}/hostnames/?contractId=${contractId}&groupId=${groupId}`,
                    body: newHostnameArray
                }

                this._edge.auth(request);
                this._edge.send((data, response) => {
                    console.timeEnd('... updating hostname');
                    if (response.statusCode >= 200 && response.statusCode < 400) {
                        response = JSON.parse(response.body);
                        resolve(response);
                    //} else if (response.statusCode == 400 || response.statusCode == 403) {
                    //    reject("Unable to assign hostname.  Please try to add the hostname in 30 minutes using the --addhosts flag.")
                    } else {
                        reject(response);
                    }
                })
            })
    })
    }

    _getEdgeHostnames(groupId, contractId) {
        return new Promise((resolve, reject) => {
            console.info('Checking for existing edge hostname');
            console.time('... checking edge hostnames');
            let request = {
                method: 'GET',
                path: `/papi/v0/edgehostnames?contractId=${contractId}&groupId=${groupId}`
            }

            this._edge.auth(request);
            this._edge.send((data, response) => {
                console.timeEnd('... checking edge hostnames');
                if (response.statusCode >= 200 && response.statusCode < 400) {
                    response = JSON.parse(response.body);
                    resolve(response);
                } else {
                    reject(response);
                }

            })
        })
    }

    /**
     *
     * @param {object} data which is the output from getGroupList
     */
    _getContractAndGroup(data, contractId, groupId) {
        if (contractId && (!contractId.match("ctr_"))) {
            contractId = "ctr_" + contractId;
        }

        return new Promise((resolve, reject) => {
            if (groupId && contractId) {
                data.contractId = contractId;
                data.groupId = groupId;
                resolve(data);
            }
            data.groups.items.map(item => {
                let queryObj = {};
                if (item.contractIds) {
                    item.contractIds.map(contract => {
                        if ((contract === contractId) && (item.groupId === groupId)) {
                            data.contractId = contractId;
                            data.groupId = groupId;
                            resolve(data);
                        }
                        if (!item.parentGroupId && !contractId) {
                            data.contractId = contract;
                            data.groupId = item.groupId;
                            resolve(data);
                        }
                    })
                }
            });
            reject("Group/Contract combination doesn't exist");
        })
    }

       _getConfigAndHostname(configName, hostnames) {
            if (!configName && typeof hostnames != "string") {
                configName = hostnames[0];
            } else if (typeof hostnames == "string") {
                hostnames = [hostnames];
             } else if (hostnames.length == 0) {
                hostnames = [configName]
            }
            if (!configName)
               configName = hostnames[0]
            let letters = "/^[0-9a-zA-Z\\_\\-\\.]+$/";
            if (!configName.match(letters)) {
                configName = configName.replace(/[^0-9a-zA-Z\\_\\-\\.]/gi, '_')
            }

            return ([configName, hostnames])
        }


    _setRules(groupId, contractId, productId, configName, cpcode=null, hostnames=[],origin=null,secure=false) {
        return new Promise((resolve, reject) => {
            if (cpcode) {
                return resolve(cpcode)
            } else {
                return this._createCPCode(groupId,
                    contractId,
                    productId,
                    configName)
            }
        })
        .then(data => {
            cpcode = data;
            return this.retrieve(configName)
        })
        .then(rules => {
            return this._updatePropertyBehaviors(rules,
                configName,
                hostnames[0],
                cpcode,
                origin,
                secure)
        })
    }

    _getPropertyInfo(contractId, groupId) {
        return this._getGroupList()
            .then(data => {
                return this._getContractAndGroup(data, contractId, groupId);
            })
            .then(data => {
                return this._getMainProduct(data.groupId, data.contractId);
            })
    }

    createCPCode(property) {
        return this._createCPCode(property);
    }

        /**
     * Advanced Metadata can't be automatically replicated, but if we preserver the UUID we can. This method loops through
     * the behaviors and matches and finds advanced entries.  The PS adv. metadata check looks at the md5() of the xml
     * and the UUID of the behavior and the rule ancestry UUID. If all of these things match then the validator will allow
     * the changes to proceed.
     * @param oldRules
     * @param newRules
     * @returns updated Rules
     */
    static mergeAdvancedUUIDRules(oldRules, newRules) {
        //find behavior: {name:"advanced"} and "match": { name: "matchAdvanced"}
        //create md5 tree of ancestry ruleUUID
        //merge over other rule matches and other behaviors
        //flag changes that can't be promoted automatically

        let search = (ruleNode, parentRules = [], found = {}) => {
            let nodeList = ruleNode.behaviors.concat(ruleNode.criteria);
            nodeList.forEach(advNode => {
                //look for "advanced" behaviors
                if (advNode && (advNode.name === "advanced"
                    || advNode.name === "matchAdvanced")) {

                    let xml = advNode.options.xml || ''
                        + advNode.options.openXml || ''
                        + advNode.options.closeXml || '';
                    let newParentRules = ruleNode.uuid !== "default" ? parentRules.concat([ruleNode]) : parentRules;
                    let foundNode = {
                        uuid: advNode.uuid,
                        xml: xml,
                        advNode: advNode,
                        parentRules: newParentRules,
                        md5: md5(xml)
                    };
                    //should we allow for multiple uses of the same hash?
                    if (!found[foundNode.md5]) found[foundNode.md5] = [];
                    found[foundNode.md5].push(foundNode);
                    //console.log("Found: %s with %s parents", foundNode.uuid, newParentRules.length);
                }
            });

            if (ruleNode.children) {
                let newParentRules = ruleNode.uuid !== "default" ? parentRules.concat([ruleNode]) : parentRules;
                ruleNode.children.forEach(childRule => {
                    search(childRule, newParentRules, found);
                });
            }
            return found;
        };

        let oldAdvMtdBehaviors = search(oldRules);
        let newAdvMtdBehaviors = search(newRules);
        Object.keys(newAdvMtdBehaviors).forEach(key => {
            newAdvMtdBehaviors[key].forEach(newAdvObject => {
                let oldAdvObjectList = oldAdvMtdBehaviors[key] || [];
                let oldAdvObject = oldAdvObjectList.find(x => newAdvObject.parentRules.length === x.parentRules.length);

                if (oldAdvObject) {
                    //copy the chain of rules UUIDs over
                    for (let i = 0; i < newAdvObject.parentRules.length; i++) {
                        //console.log("Moving Rule UUID: %s --> %s", oldAdvObject.parentRules[i].uuid, newAdvObject.parentRules[i].uuid);

                        newAdvObject.parentRules[i].uuid = oldAdvObject.parentRules[i].uuid;
                    }
                    // copy the behavior UUID
                    //console.log("Moving Behavior UUID: %s --> %s", newAdvObject.advNode.uuid, oldAdvObject.advNode.uuid);
                    newAdvObject.advNode.uuid = oldAdvObject.advNode.uuid;

                    //cleanup items in our array
                    oldAdvMtdBehaviors[key] = oldAdvMtdBehaviors[key].filter(x => x != oldAdvObject);
                } else {
                    throw Error("Cannot find Advanced Metadata in the destination rules. For safety, the Advanced behavior has to have been previously pushed on the destination config: " + newAdvObject.xml);
                }
            });
        });

        return newRules;
    }

    /**
     * Lookup the PropertyId using the associated Host name. Provide the environment if the Hostname association is
     * moving between configurations.
     *
     * @param {string} hostname for example www.example.com
     * @param {string} env for the latest version lookup (PRODUCTION | STAGING | latest)
     * @returns {Promise} the {object} of Property as the {TResult}
     */
    lookupPropertyIdFromHost(hostname, env = LATEST_VERSION.PRODUCTION) {
        return this._getProperty(hostname, env);
    }

    /**
     * Retrieve the configuration rules for a given property. Use either Host or PropertyId to use as the lookup
     * for the rules
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {number} versionLookup specify the version or use LATEST_VERSION.PRODUCTION / STAGING / latest
     * @returns {Promise} with the property rules as the {TResult}
     */
    retrieve(propertyLookup, versionLookup = LATEST_VERSION.LATEST) {
        let propertyId;
        return this._getProperty(propertyLookup)
            .then(property => {
                let version = (versionLookup && versionLookup > 0) ? versionLookup : WebSite._getLatestVersion(property, versionLookup)
                console.info(`Retrieving ${property.propertyVersion} v${version}`);
                return this._getPropertyRules(property.propertyId, version)
            });
    }

      /**
     * Retrieve the configuration rules for a given property. Use either Host or PropertyId to use as the lookup
     * for the rules
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {number} versionLookup specify the version or use LATEST_VERSION.PRODUCTION / STAGING / latest
     * @returns {Promise} with the property rules as the {TResult}
     */

    retrieveToFile(propertyLookup, toFile, versionLookup = LATEST_VERSION.LATEST) {
        return this.retrieve(propertyLookup, versionLookup)
            .then(data => {
                console.info(`Writing ${propertyLookup} rules to ${toFile}`);
                if (toFile === '-') {
                    console.log(JSON.stringify(data));
                    return Promise.resolve(data);
                } else {
                    return new Promise((resolve, reject) => {
                        fs.writeFile(untildify(toFile), JSON.stringify(data, '', 2), (err) => {
                            if (err)
                                reject(err);
                            else
                                resolve(data);
                        });
                    });
                }
            });
    }

    /**
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {Object} newRules of the configuration to be updated. Only the {object}.rules will be copied.
     * @returns {Promise} with the property rules as the {TResult}
     */
    update(propertyLookup, newRules) {
        let property = propertyLookup;

        return this._getProperty(propertyLookup)
            .then(localProp => {
                property = localProp;
                console.info(`Updating ${property}`);
                const version = WebSite._getLatestVersion(property);
                return this._copyPropertyVersion(property, version);
            })
            .then(newVersionId => {
                property.latestVersion = newVersionId;
                return this.retrieve(property, newVersionId);
            })
            .then(oldRules => {
                let updatedRules = newRules;
                // fallback in case the object is just the rules and not the full proeprty manager response
                updatedRules.rules = WebSite.mergeAdvancedUUIDRules(oldRules.rules, newRules.rules) ? newRules.rules : newRules;
                ;
                return this._updatePropertyRules(property, oldRules.propertyVersion, updatedRules);
            });
    }

    /**
     * Create a new version of a property, copying the rules from a file stream. This allows storing the property configuration
     * in a version control system and then updating the Akamai system when it becomes live. Only the Object.rules from the file
     * will be used to update the property
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {string} fromFile the filename to read a previously saved (and modified) form of the property configuration.
     *     Only the {Object}.rules will be copied
     * @returns {Promise} returns a promise with the updated form of the
     */
    updateFromFile(propertyLookup, srcFile) {
        return new Promise ((resolve, reject) => {
            fs.readFile(untildify(srcFile), (err, data) => {
                if (err)
                    reject(err);
                else
                    resolve(JSON.parse(data));
            });

        })
        .then(data => {
            return this.update(propertyLookup, data)
        })
    }

    /**
     * Create a new version of a property, copying the rules from another seperate property configuration. The common use
     * case is to migrate the rules from a QA setup to the WWW setup. If the version is not provided, the LATEST version
     * will be assumed.
     *
     * @param {string} fromProperty either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {number} fromVersion optional version number. Will assume LATEST_VERSION.LATEST if none are specified
     * @param {string} toProperty either colloquial host name (www.example.com) or canonical PropertyId (prp_123456)
     * @returns {Promise} returns a promise with the TResult of boolean
     */
    copy(fromProperty, fromVersion = LATEST_VERSION.LATEST, toProperty) {
        return this.retrieve(fromProperty, fromVersion)
            .then(fromRules => {
                console.info(`Copy ${fromProperty} v${fromRules.propertyVersion} to ${toProperty}`);
                return this.update(toProperty, fromRules)
            });
    }

    /**
     * Convenience method to promote the STAGING version of a property to PRODUCTION
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {string} notes describe the reason for activation
     * @param {string[]} email notivation email addresses
     * @returns {Promise} returns a promise with the TResult of boolean
     */

    //TODO: rename promoteStageToProd to activateStagingToProduction
    promoteStagingToProd(propertyLookup, notes = '', email = ['test@example.com']) {
        let stagingVersion;
        //todo: make sure email is an array
        return this._getProperty(propertyLookup)
            .then(property => {
                if (!property.stagingVersion)
                    new Promise(resolve => reject(`No version in Staging for ${propertyLookup}`));
                else if (property.productionVersion !== property.stagingVersion)
                    return this.activate(propertyLookup, stagingVersion, AKAMAI_ENV.PRODUCTION, notes, email);
                else
                    new Promise(resolve => resolve(true));
            });
    }

    /**
     * Activate a property to either STAGING or PRODUCTION. This function will poll (30s) incr. until the property has
     * successfully been promoted.
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {number} version version to activate
     * @param {string} networkEnv Akamai environment to activate the property (either STAGING or PRODUCTION)
     * @param {string} notes describe the reason for activation
     * @param {string[]} email notivation email addresses
     * @param {boolean} wait whether the Promise should return after activation is completed across the Akamai
     *     platform (wait=true) or if it should return immediately after submitting the job (wait=false)
     * @returns {Promise} returns a promise with the TResult of boolean
     */
    activate(propertyLookup, version = LATEST_VERSION.LATEST, networkEnv = AKAMAI_ENV.STAGING, notes = '', email = ['test@example.com'], wait = true) {
        //todo: change the version lookup

        let emailNotification = email;
        if (!Array.isArray(emailNotification))
            emailNotification = [email];
        let activationVersion = version;
        let property = propertyLookup;

        return this._getProperty(propertyLookup)
            .then(data => {
                property = data;
                if (!version || version <= 0)
                    activationVersion = WebSite._getLatestVersion(property, version);

                console.info(`Activating ${propertyLookup} to ${networkEnv}`);
                return this._activateProperty(property, activationVersion, networkEnv, notes, emailNotification)
            })
            .then(activationId => {
                if (networkEnv === AKAMAI_ENV.STAGING)
                    property.stagingVersion = activationVersion;
                else
                    property.productionVersion = activationVersion;
                if (wait)
                    return this._pollActivation(propertyLookup, activationId);
                return Promise.resolve(activationId);
            })
    }

    /**
     * De-Activate a property to either STAGING or PRODUCTION. This function will poll (30s) incr. until the property has
     * successfully been promoted.
     *
     * @param {string} propertyLookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     * @param {string} networkEnv Akamai environment to activate the property (either STAGING or PRODUCTION)
     * @param {string} notes describe the reason for activation
     * @param {Array} email notivation email addresses
     * @param {boolean} wait whether the Promise should return after activation is completed across the Akamai
     *     platform (wait=true) or if it should return immediately after submitting the job (wait=false)
     * @returns {Promise} returns a promise with the TResult of boolean
     */
    deactivate(propertyLookup, networkEnv = AKAMAI_ENV.STAGING, notes = '', email = ['test@example.com'], wait = true) {
        if (!Array.isArray(email))
            email = [email];
        let property;

        return this._getProperty(propertyLookup)
            .then(data => {
                property = data;
                console.info(`Deactivating ${propertyLookup} to ${networkEnv}`);
                let deactivationVersion = WebSite._getLatestVersion(property, networkEnv == AKAMAI_ENV.STAGING ? LATEST_VERSION.STAGING : LATEST_VERSION.PRODUCTION) || 1;
                return this._deactivateProperty(property, deactivationVersion, networkEnv, notes, email)
            })
            .then(activationId => {
                if (!activationId) {
                    return Promise.resolve();
                }
                if (networkEnv === AKAMAI_ENV.STAGING)
                    property.stagingVersion = null;
                else
                    property.productionVersion = null;
                if (wait)
                    return this._pollActivation(propertyLookup, activationId);
                return Promise.resolve(activationId);
            })
    }

    assignEdgeHostname(propertyLookup, edgeHostname) {
        const version = WebSite._getLatestVersion(propertyLookup);
        let contractId,
            groupId,
            productId,
            propertyId,
            configName;

        return this._getProperty(propertyLookup)
            .then(data => {
                contractId = data.contractId;
                groupId = data.groupId;
                configName = data.propertyName;
                propertyId = data.propertyId;
                return this._getHostnameList(configName, version, false)
            })
            .then(hostnamelist => {
                hostlist = hostnamelist.hostnames.items;
                return this._assignHostnames(groupId,
                            contractId,
                            configName,
                            null,
                            propertyId,
                            null,
                            true);
            }).then(data => {
                return Promise.resolve();
            })
    }

    /**
     * Deletes the specified property from the contract
     *
     * @param {string} property Lookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     */
    deleteProperty(propertyLookup) {
        //TODO: deactivate first
        return this._getProperty(propertyLookup)
            .then(property => {
                console.info(`Deleting ${propertyLookup}`);
                return this._deleteConfig(property)
            })
    }

    /**
     * Moves the specified property to a new group
     *
     * @param {string} property Lookup either colloquial host name (www.example.com) or canonical PropertyId (prp_123456).
     *     If the host name is moving between property configurations, use lookupPropertyIdFromHost()
     */
    moveProperty(propertyLookup, destGroup) {
        //TODO: deactivate first
        console.info(`Moving ${propertyLookup} to ` + destGroup);

        return this._moveProperty(propertyLookup, destGroup)
    }

    delHostnames(propertyLookup, hostnames) {
        const version = WebSite._getLatestVersion(propertyLookup);
        let contractId,
            groupId,
            productId,
            propertyId,
            configName,
            hostlist;

        let names = this._getConfigAndHostname(propertyLookup, hostnames);
        configName = names[0];
        hostnames = names[1];


        return this._getProperty(propertyLookup)
            .then(data => {
                contractId = data.contractId;
                groupId = data.groupId;
                configName = data.propertyName;
                propertyId = data.propertyId;
                return this._getHostnameList(configName, version)
            })
            .then(hostnamelist => {
                hostlist = hostnamelist.hostnames.items;
                return this._assignHostnames(groupId,
                            contractId,
                            configName,
                            null,
                            propertyId,
                            hostnames,
                            true);
            }).then(data => {
                return Promise.resolve();
            })
    }

    addHostnames(propertyLookup, hostnames, edgeHostname=null) {
        let contractId,
            groupId,
            productId,
            propertyId,
            configName,
            hostlist;

        let names = this._getConfigAndHostname(propertyLookup, hostnames);
        configName = names[0];
        hostnames = names[1];
        const version = WebSite._getLatestVersion(configName);


        return this._getProperty(configName)
            .then(data => {
                contractId = data.contractId;
                groupId = data.groupId;
                configName = data.propertyName;
                propertyId = data.propertyId;
                return this._getMainProduct(groupId, contractId)
            })
            .then(product => {
                productId = product.productId;
                return this._getHostnameList(configName, version)
            })
           .then(hostnamelist => {
                hostlist = hostnamelist.hostnames.items;
                let ehn = hostlist[0]["edgeHostnameId"]
                if (!ehn) {
                    ehn = hostlist[0]["cnameTo"]
                }
                return Promise.resolve(ehn)
            })
            .then(edgeHostnameId => {
                return this._assignHostnames(groupId,
                            contractId,
                            configName,
                            edgeHostnameId,
                            propertyId,
                            hostnames);
            }).then(data => {
                return Promise.resolve();
            })
    }

      setVariables(propertyLookup, variablefile) {
        let version = WebSite._getLatestVersion(propertyLookup);
        let changeVars = {
            "delete":[],
            "create":[],
            "update":[]
        };

        return new Promise ((resolve, reject) => {
            fs.readFile(untildify(variablefile), (err, data) => {
                if (err)
                    reject(err);
                else
                    resolve(JSON.parse(data));
            });
        })
        .then(data => {
            data.map(variable => {
                variable.action.map(action => {
                    changeVars[action].push(variable);
                })
            })
            return this._getPropertyRules(propertyLookup, version)
        })
        .then(data => {
            let newVars = data.rules.variables || [];

            changeVars['create'].map(variable => {

                let index_check = newVars.findIndex(elt=>elt.name==variable.name);

                if (index_check < 0) {
                    delete variable.action;
                    newVars.push(variable)
                    changeVars['update'].splice(
                        changeVars['update'].findIndex(
                            elt => elt.name === variable.name
                        )
                    )
                } else {
                    console.log("... not creating existing variable " + variable.name)
                }
            })

            changeVars['delete'].map(variable => {
                newVars.splice(
                    newVars.findIndex(
                        elt => elt.name === variable.name)
                    )
                    console.log("... deleting variable " + variable.name)
            })

            changeVars['update'].map(variable => {
                let ind = newVars.findIndex(elt=>elt.name==variable.name);
                if (ind >= 0 ) {
                    delete variable.action;
                    console.log("... updating existing variable " + variable.name)
                    newVars[ind] = variable;
                }
            })

            data.rules.variables = newVars;

            return Promise.resolve(data);
            })
            .then(rules => {
                return this._updatePropertyRules(propertyLookup,version,rules);
        })
    }


    setOrigin(propertyLookup, origin, forward) {
        let version = WebSite._getLatestVersion(propertyLookup);
        let forwardHostHeader;
        let customForward = "";

        if (forward == "origin") {
            forwardHostHeader = "ORIGIN_HOSTNAME"
        } else if (forward == "incoming") {
            forwardHostHeader = "REQUEST_HOST_HEADER"
        } else if (forward) {
            forwardHostHeader = "CUSTOM"
            customForward = forward
        }

          return this._getPropertyRules(propertyLookup, version)
            .then(data => {
                let behaviors = [];

                data.rules.behaviors.map(behavior => {
                    if (behavior.name == "origin") {
                        if (origin) {
                            behavior.options.hostname = origin;
                        }
                        if (forwardHostHeader) {
                            behavior.options.forwardHostHeader = forwardHostHeader;
                            if (customForward) {
                                behavior.options.customForwardHostHeader = customForward;
                            } else {
                                delete(behavior.options.customForwardHostHeader);
                            }
                        }
                    }
                    behaviors.push(behavior);
                })
                data.rules.behaviors = behaviors;
                return Promise.resolve(data);
            })
            .then(rules => {
                return this._updatePropertyRules(propertyLookup,version,rules);
            })
    }

    setSureRoute(propertyLookup, map, srto, tohost) {
        let version = WebSite._getLatestVersion(propertyLookup);

          return this._getPropertyRules(propertyLookup, version)
            .then(data => {
                let behaviors = [];

                data.rules.behaviors.map(behavior => {
                    if (behavior.name == "sureRoute") {
                        if (map) {
                            behavior.options.customMap = map;
                            behavior.options.type = "CUSTOM_MAP";
                        }
                        if (srto) {
                            behavior.options.testObjectUrl = srto;
                        }
                        if (host) {
							behavior.options.toHost = tohost;
							behavior.options.toHostStatus = "OTHER";
                    }
                    behaviors.push(behavior);
                })
                data.rules.behaviors = behaviors;
                return Promise.resolve(data);
            })
            .then(rules => {
                return this._updatePropertyRules(propertyLookup,version,rules);
            })
    }

    /**
     * Adds specified hostnames to the property
     *
     * @param {string}
    */

    /**
     * Creates a new property from scratch
     *
     * @param {array} hostnames List of hostnames for the property
     * @param {string} cpcode
     * @param {string} configName
     * @param {string} contractId
     * @param {string} groupId
     * @param {object} newRules
     * @param {string} origin
     */

    create(hostnames = [], cpcode = null, configName = null, contractId = null, groupId = null, newRules = null, origin = null, edgeHostname=null, secure=false) {
        if (!configName && !hostnames) {
            return Promise.reject("Configname or hostname are required.")
        }
        let names = this._getConfigAndHostname(configName, hostnames);
        configName = names[0];
        hostnames = names[1];

        if (!origin) {
            origin = "origin-" + configName;
        }

        let productId,
            productName,
            propertyId,
            edgeHostnameId;

        return this._getPropertyInfo(contractId, groupId)
            .then(data => {
                if (!contractId) {
                    contractId = data.contractId;
                }
                if (!groupId) {
                    groupId = data.groupId;
                }
                return this._getMainProduct(groupId, contractId);
            })
            .then(data => {
                productId = data.productId;
                return this._createProperty(groupId,
                    contractId,
                    configName,
                    productId);
            })
            .then(data => {
                propertyId = data;
                return this._getProperty(propertyId, groupId, contractId);
            })
            .then(data => {
                return this._getNewProperty(propertyId, groupId, contractId);
            })
            .then(data => {
                let propInfo=data.properties.items[0];
                this._propertyByName[propInfo.propertyName] = propInfo;
                this._propertyById[propInfo.propertyId] = propInfo;
                this._propertyByName[configName] = propInfo;

                if (newRules) {
                    return Promise.resolve(newRules)
                } else {
                    return this._setRules(groupId, contractId, propertyId, configName, cpcode, hostnames, origin, secure)
                }
            })
             .then(rules => {
                return this._updatePropertyRules(configName,
                    1,
                    rules);
            })
            .then(data => {
                if (edgeHostname) {
                    if(edgeHostname.indexOf("edgekey") > -1) {
                          secure=true;
                    }
                    edgeHostnameId = this._ehnByHostname[edgeHostname];
                    return Promise.resolve(edgeHostnameId);
                } else if (data.edgeHostnameId) {
                        edgeHostnameId = data.edgeHostnameId;
                        return Promise.resolve(edgeHostnameId);
                } else {
                    return this._createHostname(groupId,
                    contractId,
                    configName,
                    productId);
                }
            })
            .then(edgeHostnameId => {
                return this._assignHostnames(groupId,
                    contractId,
                    configName,
                    edgeHostnameId,
                    propertyId,
                    hostnames,
                    false,
                    true);
            }).then(() => {
                return Promise.resolve();
            })
    }

    createFromFile(hostnames = [], srcFile, configName = null, contractId = null, groupId = null, cpcode = null, origin=null,edgeHostname=null) {
        let names = this._getConfigAndHostname(configName, hostnames);
        configName = names[0];
        hostnames = names[1];
        return new Promise ((resolve, reject) => {
            fs.readFile(untildify(srcFile), (err, data) => {
                if (err)
                    reject(err);
                else
                    resolve(JSON.parse(data));
            });

        })
        .then(rules => {
            return this.create(hostnames, cpcode, configName, contractId, groupId, rules, origin, edgeHostname)
        })

     }

    createFromExisting( srcProperty,
                        srcVersion = LATEST_VERSION.LATEST,
                        copyHostnames = false,
                        hostnames = [],
                        configName = null,
                        contractId = null,
                        groupId = null,
                        origin=null,
                        edgeHostname=null,
                        cpcode=null,
                        secure=false) {
        let names = this._getConfigAndHostname(configName, hostnames);
        configName = names[0];
        hostnames = names[1];

        let cloneFrom,
            productId,
            productName,
            propertyId,
            edgeHostnameId;


       return this._getProperty(srcProperty)
             .then(data => {
                return this._getCloneConfig(srcProperty, srcVersion = srcVersion)
            })
            .then(data => {
                cloneFrom = data;
                productId = data.productId;
                if (!cpcode) {
                    cpcode = data.cpcode;
                }
                if (!groupId) {
                    groupId = data.groupId;
                    contractId = data.contractId;
                }

                if (edgeHostname) {
                    if(edgeHostname.indexOf("edgekey") > -1) {
                          secure=true;
                    }
                    edgeHostnameId = this._ehnByHostname[edgeHostname];
                    return Promise.resolve(edgeHostnameId);
                } else if (data.edgeHostnameId) {
                        edgeHostnameId = data.edgeHostnameId;
                        return Promise.resolve(edgeHostnameId);
                } else {
                    return Promise.resolve();
                }
            })
            .then(() => {

                return this._createHostname(groupId,
                            contractId,
                            configName,
                            productId,
                            edgeHostnameId);
                })
            .then(data => {
                edgeHostnameId = data;
                return this._createProperty(groupId,
                    contractId,
                    configName,
                    productId,
                    cloneFrom);
            })
            .then(data => {
                propertyId = data;
                return this._getNewProperty(propertyId, groupId, contractId);
            })
            .then(data => {
                let propInfo=data.properties.items[0];
                this._propertyByName[propInfo.propertyName] = propInfo;
                this._propertyById[propInfo.propertyId] = propInfo;
                this._propertyByName[configName] = propInfo;
                return this._setRules(groupId, contractId, propertyId, configName, cpcode, hostnames, origin, secure)
            })
             .then(rules => {
                return this._updatePropertyRules(configName,
                    1,
                    rules);
            })
            .then(property => {
                    return this._assignHostnames(groupId,
                            contractId,
                            configName,
                            edgeHostnameId,
                            propertyId,
                            hostnames,
                            false,
                            true);
             }).then(data => {
                        return Promise.resolve();
            })
        }
    }


WebSite.AKAMAI_ENV = Object.freeze(AKAMAI_ENV);
WebSite.LATEST_VERSION = Object.freeze(LATEST_VERSION);

module.exports = WebSite;
