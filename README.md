# Akamai CLI for Property Manager

*NOTE:* This tool is intended to be installed via the Akamai CLI package manager, which can be retrieved from the releases page of the [Akamai CLI](https://github.com/akamai/cli) tool.

### Local Install, if you choose not to use the akamai package manager
* Node 7
* npm install after *every* update
* Ensure that the 'bin' subdirectory is in your path

### Credentials
In order to use this configuration, you need to:
* Set up your credential files as described in the [authorization](https://developer.akamai.com/introduction/Prov_Creds.html) and [credentials](https://developer.akamai.com/introduction/Conf_Client.html) sections of the getting started guide on developer.akamai.com.  
* When working through this process you need to give grants for the property manager API and the User Admin API (if you will want to move properties).  The section in your configuration file should be called 'papi'.

## Overview
The Akamai Config Kit is a set of nodejs libraries that wraps Akamai's {OPEN} APIs to help simplify common configuration tasks.  

This kit can be used in different ways:
* [As a no-fuss command line utility](#akamaiProperty) to interact with the library.
* [As a library](#library) you can integrate into your own Node.js application.
* [As a gulp integration](#gulp) to integrate with your Continuous Integration/Continuous Deployment toolset.

```
MacBook-Pro:AkamaiOPEN-edgegrid-python khunter$ akamai property
Usage: akamai property <command> <args> [options]

Commands:
  groups                 retrieve account groups
  formats                get rules formats
  search <property>      search for a property name
  create <property>      create a new property
  modify <property>      modify specified property
  activate <property>    activate the property
  deactivate <property>  deactivate the property
  delete <property>      delete a property
  update <property>      update target property
  retrieve <property>    retrieve rules from target property

Command options:
  --config <config>    Config file                [file] [default: /Users/khunter/.edgerc]
  --section <section>  Config section                             [string] [default: papi]
  --debug <debug>      Turn on debugging.                                        [boolean]
  --help               Show help                                [commands: help] [boolean]
  --version            Show version number                   [commands: version] [boolean]

Copyright (C) Akamai Technologies, Inc
Visit http://github.com/akamai/cli-property for detailed documentation
```

## akamaiProperty
This script wraps all of the functionality from the [library](#library) into a command line utility which can be used to support the following use cases.  All of the functions expect the config name.
* [Create property](#create)
* [Retrieve property rules](#retrieve)
* [Update a property](#update)
* [Activate or deactivate](#activate)
* [Modify a property](#modify)

### Create
```
Usage: akamai property create <property>(default: [$AKAMAI_PAPI_PROPERTY]) [options]

Arguments:
  <property>                                                           [required] [string]

Source options:
  --clone <from>      Source property to clone from                               [string]
  --srcver <version>  Version for source property                                 [string]
  --file <path>       Source file for new property rules               [file] [must exist]
  --nocopy            Do not copy cloned hostnames                               [boolean]

Hostname options:
  --hostnames <list>             Comma delimited list of hostnames for property
                                 [array:string]

  --origin <origin>              Origin to set for property
                                 [string]

  --edgehostname <edgehostname>  Edge hostname to use
                                 [string]

  --forward <value>              Forward host header (origin|incoming|<host>)
                                 [string]

Location options:
  --cpcode <cpcode>      Use specified cpcode for new property                    [number]
  --contract <contract>  Contract for new property                                [string]
  --group <group>        Group for new property                                   [string]
  --product <product>    Product for new property                                 [string]

General options:
  --ruleformat <format>  Use specified rule format                                [string]
  --notes <notes>        Version notes for the property version                   [string]
  --retrieve             Retrieve rules for created property                     [boolean]

Command options:
  --config <config>    Config file                [file] [default: /Users/khunter/.edgerc]
  --section <section>  Config section                             [string] [default: papi]
  --debug <debug>      Turn on debugging.                                        [boolean]
  --help               Show help                                [commands: help] [boolean]
  --version            Show version number                   [commands: version] [boolean]

Copyright (C) Akamai Technologies, Inc
Visit http://github.com/akamai/cli-property for detailed documentation
```

### Retrieve
```
Usage: akamai property retrieve <property>(default: [$AKAMAI_PAPI_PROPERTY]) [options]

Arguments:
  <property>                                                           [required] [string]

General options:
  --format       Rules format only                                               [boolean]
  --hostnames    Retrieve hostnames for property                                 [boolean]
  --variables    Retrieve user variables                                         [boolean]
  --propver      Retrieve specified version                                       [number]
  --file <path>  Output file                                                        [file]

Command options:
  --config <config>    Config file                [file] [default: /Users/khunter/.edgerc]
  --section <section>  Config section                             [string] [default: papi]
  --debug <debug>      Turn on debugging.                                        [boolean]
  --help               Show help                                [commands: help] [boolean]
  --version            Show version number                   [commands: version] [boolean]

Copyright (C) Akamai Technologies, Inc
Visit http://github.com/akamai/cli-property for detailed documentation
```

### Update
Update the current property version with the rules from a local file, or copy from another property.

```
Usage: akamai property update <property>(default: [$AKAMAI_PAPI_PROPERTY]) [options]

Arguments:
  <property>                                                           [required] [string]

General options:
  --srcprop <property>  Source property                                           [string]
  --srcver <version>    Source version                                            [string]
  --file <path>         File with JSON rules                           [file] [must exist]

Command options:
  --config <config>    Config file                [file] [default: /Users/khunter/.edgerc]
  --section <section>  Config section                             [string] [default: papi]
  --debug <debug>      Turn on debugging.                                        [boolean]
  --help               Show help                                [commands: help] [boolean]
  --version            Show version number                   [commands: version] [boolean]

Copyright (C) Akamai Technologies, Inc
Visit http://github.com/akamai/cli-property for detailed documentation
```

### Activate
Activate the specified property version on staging, production or both.

```
Usage: akamai property activate <property>(default: [$AKAMAI_PAPI_PROPERTY]) [options]

General options:
  --network <network>  Network for activation      [required] [enum] [PROD, STAGING, BOTH]
  --propver <version>  Source version to activate                                 [number]
  --email <address>    Email for confirmation                                     [string]
  --notes <note>       Add a note on activation                                   [string]

Command options:
  --config <config>    Config file                [file] [default: /Users/khunter/.edgerc]
  --section <section>  Config section                             [string] [default: papi]
  --debug <debug>      Turn on debugging.                                        [boolean]
  --help               Show help                                [commands: help] [boolean]
  --version            Show version number                   [commands: version] [boolean]

Copyright (C) Akamai Technologies, Inc
Visit http://github.com/akamai/cli-property for detailed documentation
```

### Modify
```

Usage: akamai property modify <property>(default: [$AKAMAI_PAPI_PROPERTY]) [options]

General options:
  --propver <propver>        Property version                                     [number]
  --ruleformat <ruleformat>  Switch property to specified rule format             [string]
  --notes <notes>            Version notes for the property version               [string]
  --new                      Create new property version.                        [boolean]
  --variables <file>         File with user variables. Format should be:
                             [
                               {
                                 "name": "PMUSER_TEST",
                                 "value": "Foobar",
                                 "description": "This is my test variable",
                                 "hidden": false,
                                 "sensitive": false,
                                 "action": [
                                   "delete",
                                   "update",
                                   "create"
                                 ]
                               }
                             ]                                           [file]

Hostname options:
  --addhosts <addhosts>          Comma delimited list of hostnames          [array:string]
  --delhosts <delhosts>          Comma delimited list of hostnames          [array:string]
  --edgehostname <edgehostname>  Edge hostname to use                             [string]
  --origin <origin>              Host for origin                                  [string]
  --forward <forward>            Forward host header (origin|incoming|<host>)     [string]

SureRoute options:
  --sureroutemap <sureroutemap>        Map for SureRoute                          [string]
  --surerouteto <surerouteto>          "To" entry for SureRoute                   [string]
  --sureroutetohost <sureroutetohost>  Target host entry for SureRoute            [string]

Location options:
  --cpcode <cpcode>  Use specified cpcode for new property                        [number]
  --move <move>      Group to move the property to (User Admin perms)             [string]

Command options:
  --config <config>    Config file                [file] [default: /Users/khunter/.edgerc]
  --section <section>  Config section                             [string] [default: papi]
  --debug <debug>      Turn on debugging.                                        [boolean]
  --help               Show help                                [commands: help] [boolean]
  --version            Show version number                   [commands: version] [boolean]

```

## Gulp

Download the Gulp integration project from https://github.com/akamai-open/gulp-akamaiconfigkit

In your gulpfile, include the library and define your build targets.

```
let gulp = require('gulp'),
    akamaiconfig = require('gulp-akamaiconfigkit');

const localConfig = {
    host: 'www.example.com',
    smokeTestUrls: ['/'],
    emailNotification: 'nobody@akamai.com',

};

const credConfig = {
    path: "~/.edgerc",
    section: "papi"
}


let akamai = new akamaiconfig(credConfig);

gulp.task('deploy-akamai', () => {
    return gulp.src("src/akamai/rules.json")
        .pipe(akamai.deployStaging(localConfig))
        .pipe(akamai.testStaging(localConfig.host, localConfig.smokeTestUrls))
        .pipe(akamai.promoteStagingToProduction(localConfig));
})
```

This integration can be used to have a CD tool such as Jenkins push changes to Akamai whenever a rules file changes in your SCM.  This allows you to treat your configuration as code and keep your own rules locally.

## Library

Start with creating the WebSite object:

```
let WebSite = require('akamaiconfigkit').WebSite;
let exampleDotCom = new WebSite();

exampleDotCom.copy("qa-www.example.com", "sage-www.example.com")
  .then(data -> { console.log("Rules copied accross Akamai configurations!")});
```

This will use the [default] credentials in the ~/.edgerc file. Alternate object creations include:

Specifying to use the `[continuous_delivery]` section in the file `/cyberark/edgerc`

```
let exampleDotCom = new WebSite({path:"/cyberark/edgerc", section: "[continuous_delivery]"});
```

You can alternatively specify the `clientToken`, `clientSecret`, `accessToken`, and `host` as properties of the
constructor object

```
let exampleDotCom = new WebSite({clientToken:"a1b2", clientSecret: "c3d4", accessToken: "e5f6", host: "g7h8.luna.akamaiapis.net"});
```

## Caveats
The Akamai CLI is a new tool and as such we have made some design choices worth mentioning.
* Edge Hostnames - if not specified, the system will create a new edge hostname, but cannot assign it as it will not yet be active.  You will need to run a 'modify' subsequently to assign the hostname.
* CPCodes - there is currently a fairly strict limitation on creation of CPCodes.  To work around this, pass in a specific CPCode to use.  Your account team can create a bunch of CPCodes which you could then use with your properties.  Cloned properties will inherit the CPCode of the cloned property.
* Credentials - the tool expects your credentials to be stored under a 'papi' section in your ~/.edgerc file.  If you are unfamiliar with the authentication and provisioning for OPEN APIs, see the "Get Started" section of https://developer.akamai.com
* Move - in order to perform move functions, the credentials must have both property manager and user admin grants.  
