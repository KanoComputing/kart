# kart — Kano Archive and Release Tool

[![Build Status](https://travis-ci.org/KanoComputing/kart.svg?branch=master)](https://travis-ci.org/KanoComputing/kart)

Kart is a library and CLI tool to help managing releases. It has two main usecases:

 * Archiving builds per project and stability channel
 * Releasing builds from the archive

 It uses AWS S3 as a storage provider for the archive. The release process has been
 designed in a modular way to allow for a wide range of deploy methods to be supported
 in the future. The only one implemented right now is, again, S3.

Kart stores all the builds and part of its configuration in a **root bucket** that
you'll need to setup on your system before using it.


## Installation

Kart is hosted on [npm](https://www.npmjs.com/package/kart). Run the following command to install it

    npm i -g kart


## Configuration

This section explains what you need to do before you can start using kart.

### Local

By default, kart will look for a configuration file in your home directory:

```
~/.kartrc
```

On the inside it's a JSON file with the following structure:

```json
{
    "rootBucket": {
        "name": "<<your-root-S3-bucket-name-here>>",
        "config": "kart-projects.json"
    },
    "awsKey": "...",
    "awsSecret": "..."
}
```

Only `rootBucket.name` is mandatory. You can use `rootBucket.config` to override where kart
will be looking for the remote config inside your root bucket. You can also provide AWS
credentials as the example above shows. If omitted, kart will use your
[system AWS settings](http://docs.aws.amazon.com/cli/latest/userguide/cli-config-files.html)
by default.

### Remote

_You only need to do this if you're setting up a new archive from scratch._

As most of kart's configuration is central to a particular archive, it makes sense
to store it remotely rather then keep local copies on clients. For that, you'll
need to create an S3 bucket on AWS first. The kart configuration will live in a
`kart-projects.json` file stored at the root of the bucket (configurable via
the `rootBucket.config` option described above). The file looks something like this:

```json
{
    "motd": [
        "An optional message of the day that will be shown",
        "to users working with this archive.",
        "",
        "Can span multiple lines like so!"
    ],
    "projects": {
        "example-project": {
            "github": "username/project",
            "channels": {
                "staging": {
                    "deploy": {
                      "method": "s3",
                      "bucket": "example-staging-target"
                    },
                    "url": "https://where-is-this-served.url"
                },
                "production": {
                    "deploy": {
                      "method": "s3",
                      "bucket": "example-production-target"
                    }
                }
            }
        }
    }
}
```

You can have as many projects and channels per project as you like. S3 is the only
available deploy method at the moment.

## Working with the UI

The `kart` npm package whips with an eponymous binary that let's you easily archive
and release builds from the terminal. When in doubt, use

    kart [<command>] --help

to print the usage of the command.

### Releasing builds

To release an existing build of a project to one of the target channels type

    kart release

A simple interface will pop up and kart will walk you through the process. You
select a project, target stream and build you want to release, and kart
will deploy it.

![kart release](https://i.imgur.com/bjNSzUx.png)

You can use the `status` command to verify that everything went well.

    kart status

### Archiving builds

You shouldn't need to be archiving builds by hand, but when used in Jenkins
integrations the `archive` command can be useful.

    kart archive

Unlike the two commands above, `archive` isn't interactive. You need to specify
everything upfront via options. Run

    kart archive --help

to get the full list. Basically, you need to provide

 * A folder with the build
 * Project name
 * Version
 * Git revision
 * (optionally) Target architecture

Kart will then `tar` and `gzip` the folder and upload it to the archive with
the correct naming and metadata conventions.

If you're building an npm project from a git repository, you can use the
`--from-repo` option which will try to autodetect project name and version
from the `package.json` file and take the revision from `git rev-parse HEAD`.

You can also use the `--release` option which will archive the build and
release it at the same time, saving you a step in your scripts.

At the `archive` command prints a public URL where the build can be downloaded.

## Working with the library

You can use kart from gulp files or any other node-based scripts as follows:

```js
var kart = require('kart');

kart.configure()
    .then(() => {
        return kart.archive.store(
            './www',            // Build directory
            'example-project',  // Project name
            'staging',          // Channel
            '1.0.0',            // Version
            null,               // Optional build number
            null,               // Optional arch (defaults to 'all')
            {   // metadata
                revision: '371952bccbf69b7529faf2da6d7539db8f8152cb'
            }
        );
    })
    .then((build) => {
        return kart.release(build);
    })
    .catch((err) => {
        console.log(err);
    });
```

## Deploy Methods

A list of supported methods of releasing your builds. These can be configured
per channel in your archive's `kart-projects.json` file.

### S3

```json
    {
        "method": "s3",
        "bucket": "target-bucket",
        "algorithm": "clear|overwrite|sync"
    }
```

This method only has one option: the target bucket where your files should be
unpacked. They will be uploaded directly to the root of the bucket with
`public-read` ACL. At the moment, kart expets the bucket to be hosted under
the same account as your root bucket is.

#### Upload algorithms

Optionally, you can change the way kart uploads the file into the bucket by
setting the `algorithm` option to one of the following

* **clear** (_default behaviour_): Empty the target bucked and upload the new build into it.
* **overwrite**: Upload the new build into the bucket without removing everyting first.
* **sync**: Use `aws s3 sync` to deploy into the bucket.

### S3 Copy

```json
    {
        "method": "s3-copy",
        "track": "internal",
        "namePattern": ":project_:version-:number_:arch.:ext"
    }
```

This method copies an archive to a release track. A release track is located in the same directory as an archive.
This method will not download and extract your archive, it will copy the s3 object across

#### Naming

Optionally, you can change the naming of the relased file using the namePattern option

This option will receive the following properties from the archive:
```
project
channel
version
number
arch
ext
```
And replace the keys in your name pattern

## TODO

 * Additional deploy-methods
 * Builds cleanup via the kart binary
 * UI for remote configuration management via the kart binary
   * Adding/removing projects
 * UI for listing and downloading builds
 * Make a Github release when pushing to certain channels

## Licence

Copyright (c) 2017 Kano Computing Limited

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
