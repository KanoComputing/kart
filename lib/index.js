const aws = require('aws-sdk'),
      TarGz = require('tar.gz'),
      semver = require('semver'),
      stream = require('stream');

let s3 = null,
    config = {
        projects: {}
    };

function _isConfigured() {
    return !!s3;
}

function _downloadConfig(root) {
    return new Promise((resolve, reject) => {
        s3.getObject(
            {
                Bucket: root.name,
                Key: root.config
            },
            (err, data) => {
                if (err) {
                    return reject('Failed to download archive config: ' + error);
                }

                config = JSON.parse(data.Body.toString()) || {};
                config.rootBucket = root;

                resolve();
            }
        );
    });
    
}

function configure(c) {
    aws.config.update(
        {
          accessKeyId: c.awsKey,
          secretAccessKey: c.awsSecret,
        }
    );

    s3 = new aws.S3();
    return _downloadConfig(c.rootBucket);
}

function _getNextBuildNumber(projectName, channel, version) {
    return list(projectName, channel, {
        filter: {
            version: version
        },
        sort: {
            key: 'build',
            order: -1
        },
        limit: 1
    }).then((res) => {
        if (res.length > 0) {
            return res[0].build + 1;
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
 * @param {Number} number      (optional) Build sequence number.
 *                             Will be determined automatically when omitted.
 * @param {String} arch        Architecture for this build. Defaults to 'all'.
 * 
 */
function archiveBuild(buildDir, projectName, channel, version, number, arch) {
    if (!_isConfigured()) {
        return Promise.reject('Library not configured.');
    }

    arch = arch || 'all';

    if (number) {
        return _doArchiveBuild(buildDir, projectName, channel, version, number, arch);
    } else {
        return _getNextBuildNumber(projectName, channel, version)
            .then((n) => {
                return _doArchiveBuild(buildDir, projectName, channel, version, n, arch);
            });
    }
}

function _doArchiveBuild(buildDir, projectName, channel, version, number, arch) {
    return new Promise((resolve, reject) => {
        let tgz = new TarGz({}, {fromBase: true}),
            stream;

        stream = tgz.createReadStream(buildDir);

        s3.upload(
            {
                Bucket: config.rootBucket.name,
                Key: `${projectName}/${channel}/${projectName}_${version}-${number}_${arch}.tar.gz`,
                Body: stream
            },
            (err, data) => {
                if (err) {
                    return reject('Failed to upload archive' + err);
                }

                resolve({
                    project: projectName,
                    channel: channel,
                    path: data.Key,
                    version: version,
                    build: number,
                    arch: arch,
                    date: Date.new(),
                    url: data.Location
                });
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
        s3.deleteObject(
            {
                Bucket: config.rootBucket.name,
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

function _convertListEntryToBuild(entry) {
    let found = entry.Key.match(/([^\/]+)\/([^\/]+)\/([^_]+)_([^_-]+)-([^_-]+)_([^_]+)\.tar\.gz/);

    if (!found) {
        return null;
    }

    return {
        project: found[1],
        channel: found[2],
        path: entry.Key,
        version: found[4],
        build: parseInt(found[5]),
        arch: found[6],
        date: entry.LastModified
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
    if (!_isConfigured()) {
        return Promise.reject('Library not configured.');
    }

    opts = Object.assign({}, opts);

    return new Promise((resolve, reject) => {
        let folder = `${project}/${channel}/`,
            results;

        s3.listObjects(
            {
                Bucket: config.rootBucket.name,
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
                    .map(_convertListEntryToBuild)
                    .filter(_getFilter(opts))
                    .sort(_getComparator(opts));

                resolve(results.slice(0, opts.limit || results.length));
            }
        );
    });
}

function _deleteEntries(bucketName, entries) {
    let p = entries.map((entry) => {
        return new Promise((resolve, reject) => {
            if (!entry.Key.match(/\/$/)) {
                s3.deleteObject(
                    {
                        Bucket: bucketName,
                        Key: entry.Key
                    },
                    (err, data) => {
                        if (err) {
                            return reject('Failed to remove ' + entry.Key + ': ' + err);
                        }
    
                        resolve(entry.Key);
                    }
                );
            }
        });
    });

    return Promise.all(p);
}

function _clearBucket(bucketName) {
    return new Promise((resolve, reject) => {
        s3.listObjects(
            {
                Bucket: bucketName
            },
            (err, data) => {
                if (err) {
                    return reject('Failed to list files in ' + bucketName + ': ' + err);
                }

                _deleteEntries(bucketName, data.Contents)
                    .then(resolve);
            }
        );
    });
}

function _uploadKartFile(build, target) {
    let info = {
        project: build.project,
        channel: build.channel,
        version: build.version,
        build: build.build,
        releaseDate: new Date(),
        buildDate: build.date
    };

    return new Promise((resolve, reject) => {
        s3.upload(
            {
                Bucket: target,
                Key: 'kart.json',
                Body: JSON.stringify(info)
            },
            (err, data) => {
                if (err) {
                    return reject('Failed uploading the kart file:' + err);
                }

                resolve(info);
            }
        );
    });
}

/*
 * Download, unzip and release a build to a target bucket.
 */
function release(build) {
    let bucket = config.projects[build.project].channels[build.channel].bucket;

    return _clearBucket(bucket)
        .then(() => {
            return _doRelease(build, bucket);
        }).then(() => {
            return _uploadKartFile(build, bucket)
        });
}

function _doRelease(build, target) {
    return new Promise((resolve, reject) => {
        s3.getObject(
            {
                Bucket: config.rootBucket.name,
                Key: build.path
            },
            (err, data) => {
                if (err) {
                    return reject('Failed to download archive config: ' + error);
                }

                let rs = new stream.Readable(),
                    targz = new TarGz(),
                    parse = targz.createParseStream();

                rs._read = function () {}
                rs.push(data.Body);
                rs.push(null);

                parse.on('entry', (entry) => {
                    if (entry.type === 'File') {
                        let p = new stream.PassThrough();
                        entry.pipe(p);

                        s3.upload(
                            {
                                Bucket: target,
                                Key: entry.path,
                                Body: p,
                                ACL: 'public-read'
                            },
                            (err, data) => {
                                if (err) {
                                    return reject('Failed deploying ' + entry.path + ':' + err);
                                }
                            }
                        );
                    }
                });
 
                rs.pipe(parse);

                parse.on('finish', () => {
                    resolve();
                });
            }
        );
        // Download build
        // unzip into a temporary directory
        // wipe the target bucket
        // upload to s3
        // Write build information
        // Make files public
    });
}

module.exports = {
    configure,
    archiveBuild,
    removeBuild,
    list,
    release
};