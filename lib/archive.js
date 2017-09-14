const aws = require('aws-sdk'),
      TarGz = require('tar.gz'),
      semver = require('semver'),
      config = require('./config'),
      Build = require('./data').Build;

      
function _getNextBuildNumber(projectName, channel, version, revision) {
    let opts = {
        filter: {
            version: version
        },
        sort: {
            key: 'number',
            order: -1
        },
        limit: 1
    };

    if (revision) {
        opts.filter.revision = revision.substr(0, 7);
    }
    
    return list(projectName, channel, opts).then((res) => {
        if (res.length > 0) {
            return res[0].number + 1;
        }

        return 1;
    });
}

/*
 * Compress and upload a build to the apropriate place in the archive.
 * 
 * @param {String} buildDir    Path to a directory to be archived (top level dir won't be included).
 * @param {String} projectName Name of the project being archived (e.g., kano-code).
 * @param {String} channel     Target channel (e.g., staging).
 * @param {String} version     Semver version (e.g., 1.2.3).
 * @param {String} revision    (optional) Short git SHA (e.g, a4cd72f).
 * @param {Number} number      (optional) Build sequence number.
 *                             Will be determined automatically when omitted.
 * @param {String} arch        (optional) Architecture for this build. Defaults to 'all'.
 * 
 */
function storeBuild(buildDir, projectName, channel, version, revision, number, arch) {
    revision = revision ? revision.substr(0, 7) : null;
    arch = arch || 'all';

    if (number) {
        return _doStoreBuild(buildDir, projectName, channel, version, revision, number, arch);
    } else {
        return _getNextBuildNumber(projectName, channel, version, revision)
            .then((n) => {
                return _doStoreBuild(buildDir, projectName, channel, version, revision, n, arch);
            });
    }
}

function _doStoreBuild(buildDir, projectName, channel, version, revision, number, arch) {
    return new Promise((resolve, reject) => {
        let tgz = new TarGz({}, {fromBase: true}),
            stream,
            build;

        stream = tgz.createReadStream(buildDir);

        build = new Build({
            project: projectName,
            channel: channel,
            version: version,
            revision: revision || null,
            number: number,
            arch: arch,
            buildDate: new Date()
        });

        let s3 = new aws.S3();
        s3.upload(
            {
                Bucket: config.local.rootBucket.name,
                Key: build.path,
                Body: stream
            },
            (err, data) => {
                if (err) {
                    return reject('Failed to upload archive' + err);
                }

                resolve(build);
            }
        );
    });
}

/*
 * Remove a build from the archive by path or build object.
 * 
 * @param {String, Object} build Either a direct path to build or a build object.
 * 
 */
function removeBuild(build) {
    if (typeof build === 'string') {
        build = {path: build};
    }

    return new Promise((resolve, reject) => {
        let s3 = new aws.S3();
        s3.deleteObject(
            {
                Bucket: config.local.rootBucket.name,
                Key: build.path
            },
            (err, data) => {
                if (err) {
                    return reject('Failed to remove ' + path + ':' + err);
                }

                resolve();
            }
        );
    });
}

function _getFilter(opts) {
    return (build) => {
        let match = true;

        if (!build) {
            return false;
        }

        if (opts.filter) {
            Object.keys(opts.filter).forEach((key) => {
                if (build[key] !== opts.filter[key]) {
                    match = false;
                }
            });
        }

        return match;
    };
}

function _getComparator(opts) {
    return (a, b) => {
        let res = 0;

        if (opts.sort) {
            let keys,
                order = opts.sort.order || 1;
            
            if (!Array.isArray(opts.sort.key)) {
                keys = [opts.sort.key];
            } else {
                keys = opts.sort.key.slice(0);
            }
            
            while (res === 0 && keys.length) {
                let key = keys.shift();

                /* Exception: use semver to compare versions */
                if (key === 'version') {
                    let ca = semver.clean(a[key]),
                        cb = semver.clean(b[key]);

                    if (semver.gt(ca, cb)) {
                        res = order > 0 ? 1 : -1;
                    } else if (semver.lt(ca, cb)) {
                        res = order > 0 ? -1 : 1;
                    }
                } else {
                    if (a[key] > b[key]) {
                        res = order > 0 ? 1 : -1;
                    } else if (a[key] < b[key]) {
                        res = order > 0 ? -1 : 1;
                    }
                }
            }
        }
        
        return res;
    };
}

/*
 * List builds of a project in a channel.
 * 
 * @param {String} project The name of the project (e.g., kano-code).
 * @param {String} channel The name of the channel (e.g., staging).
 * 
 * @param {Object} opts    (optional) Modify the listing results.
 * @param {Object} opts.filter Filtering options (key value pairs).
 * 
 * @param {Object} opts.sort Sorting options.
 * @param {Sring, Array} opts.sort.key One or more keys to sort by in order of priority
 * @param {Number}       opts.sort.order 1 for ascending, -1 for descending.
 * 
 * @param {Number} opts.limit Limit the list to N entries.
 *
 */
function list(project, channel, opts) {
    opts = Object.assign({}, opts);
    
    return new Promise((resolve, reject) => {
        let folder = `${project}/${channel}/`,
        results;
        
        let s3 = new aws.S3();
        s3.listObjects(
            {
                Bucket: config.local.rootBucket.name,
                Delimiter: '/',
                Prefix: folder
            },
            (err, data) => {
                if (err) {
                    return reject('Unable to list files in the root bucket: ' + err);
                }

                results = data.Contents
                    .filter((entry) => {
                        // Remove the directory itself from the results
                        return entry.Key != folder;
                    })
                    .map(Build.fromListEntry)
                    .filter(_getFilter(opts))
                    .sort(_getComparator(opts));

                resolve(results.slice(0, opts.limit || results.length));
            }
        );
    });
}

module.exports = {
    list,
    store: storeBuild,
    remove: removeBuild
}