const fs = require('fs'),
      semver = require('semver'),
      config = require('./config'),
      Build = require('./data').Build,
      s3 = require('./s3-helpers'),
      archivers = {
        'tar.gz': require('./archivers/tar.gz.js'),
        none: require('./archivers/none.js'),
        ditto: require('./archivers/ditto.js'),
        zip: require('./archivers/zip.js'),
      };

function _getNextBuildNumber(projectName, channel, version) {
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
 * @param {String} buildDir     Path to a directory to be archived (top level dir won't be included).
 * @param {String} projectName  Name of the project being archived (e.g., kano-code).
 * @param {String} channel      Target channel (e.g., staging).
 * @param {String} version      Semver version (e.g., 1.2.3).
 * @param {Number} number       (optional) Build sequence number.
 *                              Will be determined automatically when omitted.
 * @param {String} arch         (optional) Architecture for this build. Defaults to 'all'.
 * @param {Object} metadata     (optional) Additional info to store with the build.
 * @param {String}   .revision  Git SHA to tie the build with a particular commit.
 * @param {string} type         (optional) Archive type. tar.gz, zip or none.
 */
function storeBuild(buildDir, projectName, channel, version, number, arch, metadata, type) {
    arch = arch || 'all';
    type = type || 'tar.gz';

    if (Object.keys(config.remote.projects).indexOf(projectName) < 0) {
        return Promise.reject(`Project '${projectName}' not found`);
    }

    if (Object.keys(config.remote.projects[projectName].channels).indexOf(channel) < 0) {
        return Promise.reject(`Channel '${channel}' not found in project '${projectName}'`);
    }

    if (number) {
        return _doStoreBuild(buildDir, projectName, channel, version, number, arch, metadata, type);
    } else {
        return _getNextBuildNumber(projectName, channel, version)
            .then((n) => {
                return _doStoreBuild(buildDir, projectName, channel, version, n, arch, metadata, type);
            });
    }
}

function _doStoreBuild(buildDir, projectName, channel, version, number, arch, metadata, type) {
    return new Promise((resolve, reject) => {
        fs.lstat(buildDir, (err, stat) => {
            if (err) {
                return reject(new Error(`Could not find or access build directory: ${buildDir}`));
            }

            const archiver = archivers[type];

            if (!archiver) {
                return reject(new Error(`Archiver ${type} does not exist`));
            }

            const stream = archiver.archive(buildDir);
            const build = new Build({
                project: projectName,
                channel: channel,
                version: version,
                metadata: metadata,
                number: number,
                arch: arch,
                ext: archiver.extension(buildDir),
                buildDate: new Date()
            });

            s3.getInstance().upload(
                {
                    Bucket: config.local.rootBucket.name,
                    Key: build.path,
                    Body: stream,
                    ACL: 'public-read',
                    Metadata: metadata,
                },
                (err, data) => {
                    if (err) {
                        return reject(new Error('Failed to upload archive: ' + err));
                    }

                    resolve(build);
                }
            );
        });
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
        s3.getInstance().deleteObject(
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
 *                             Filtering based on metadata not supported at the moment.
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

    if (!config.remote.projects[project]) {
        return Promise.reject(`Project '${project}' not found`);
    }

    if (!config.remote.projects[project].channels[channel]) {
        return Promise.reject(`Channel '${channel}' not found in project '${project}'`);
    }

    return new Promise((resolve, reject) => {
        let folder = `${project}/${channel}/`,
        results;

        s3.getInstance().listObjects(
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
