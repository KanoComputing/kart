const aws = require('aws-sdk'),
      TarGz = require('tar.gz'),
      stream = require('stream'),
      config = require('../config'),
      Release = require('../data').Release,
      mime = require('mime-types'),
      tmp = require('tmp'),
      childProcess = require('child_process');


function _doRelease(build, target, algorithm) {
    let s3 = new aws.S3();
    return s3.getObject({
        Bucket: config.local.rootBucket.name,
        Key: build.path
    }).promise().then((data) => {
        if (algorithm === 'clear' || algorithm === 'overwrite') {
            return _doReleaseByUpload(target, data);
        } else if (algorithm === 'sync') {
            return _doReleaseBySync(build, target, data);
        }
    }, (err) => {
        throw new Error('Failed to download build archive: ' + err);
    }).then(() => {
        let release = new Release(build);
        release.updateReleaseDate();

        return release;
    });
}

function _doReleaseByUpload(target, data) {
    return new Promise((resolve, reject) => {
        let s3 = new aws.S3(),
            rs = new stream.Readable(),
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
                        ACL: 'public-read',
                        CacheControl: 'max-age=600',
                        ContentType: mime.lookup(entry.path) || 'application/octet-stream'
                    },
                    (err, data) => {
                        if (err) {
                            reject('Failed deploying ' + entry.path + ':' + err);
                        }
                    }
                );
            }
        });

        rs.pipe(parse);

        parse.on('finish', () => {
            resolve();
        });
    });
}

function _doReleaseBySync(build, target, data) {
    return new Promise((resolve, reject) => {
        let s3 = new aws.S3(),
            rs = new stream.Readable(),
            targz = new TarGz(),
            write;

        // TODO use https://www.npmjs.com/package/tar-stream in the future

        rs._read = function () {}
        rs.push(data.Body);
        rs.push(null);

        tmp.dir({unsafeCleanup: true}, (err, path, cleanupCb) => {
            if (err) {
                return reject('Failed to create a temporary directory: ' + err);
            }

            try {
                write = targz.createWriteStream(path);
                rs.pipe(write);

                write.on('end', () => {
                    let env = Object.assign({}, process.env),
                        proc,
                        errBuffer = "";

                    if (config.local.awsKey) {
                        env.AWS_ACCESS_KEY_ID = config.local.awsKey;
                    }

                    if (config.local.awsSecret) {
                        env.AWS_SECRET_ACCESS_KEY = config.local.awsSecret;
                    }

                    proc = childProcess.spawn('aws', ['s3', 'sync', '--acl', 'public-read', '--exact-timestamps', '--delete', path, `s3://${target}`], {
                        env: env,
                        stdio: ['pipe', 'pipe', 'pipe'],
                        shell: true
                    });
                    proc.stderr.on('data', function (data) {
                        errBuffer += data + "\n";
                    });

                    proc.stdout.on('data', function (data) {
                        if (data) {
                            console.log(data.toString());
                        }
                    });

                    proc.on('close', function (code) {
                        if (code !== 0) {
                            cleanupCb();

                            if (errBuffer.toString().indexOf('aws: command not found') >= 0) {
                                console.log('It looks like you don\'t have the `aws` command on your system that is required to deploy this build.');
                                console.log('See https://aws.amazon.com/cli/ for instructions how to inststall the AWS CLI.');
                            }

                            return reject('Sync failed: ' + errBuffer.trim());
                        }

                        cleanupCb();
                        resolve();
                    });
                });
            } catch (error) {
                cleanupCb();
                throw error;
            }
        });
    });
}

function _uploadKartFile(release, target) {
    return new Promise((resolve, reject) => {
        let s3 = new aws.S3();
        s3.upload(
            {
                Bucket: target,
                Key: 'kart.json',
                Body: release.toJSON()
            },
            (err, data) => {
                if (err) {
                    return reject('Failed uploading the kart file:' + err);
                }

                resolve();
            }
        );
    });
}

function _downloadKartFile(project, channel) {
    return new Promise((resolve, reject) => {
        let s3 = new aws.S3();
        s3.getObject(
            {
                Bucket: config.remote.projects[project].channels[channel].deploy.bucket,
                Key: 'kart.json'
            },
            (err, data) => {
                if (err) {
                    if (err.code === 'NoSuchKey') {
                        return resolve(null);
                    }
                    return reject('Failed downloading kart.json: ' + err);
                }

                resolve(new Release(JSON.parse(data.Body.toString())));
            }
        );
    });
}


function _deleteEntries(bucketName, entries) {
    let p = entries.map((entry) => {
        return new Promise((resolve, reject) => {
            if (!entry.Key.match(/\/$/)) {
                let s3 = new aws.S3();
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
        let s3 = new aws.S3();
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

/**
 * Release a build.
 *
 * Uploading algorithms:
 *   * clear:     Clears the target bucket before writing the build into it.
 *   * overwrite: Writes all the files into the bucked without clearing it out first.
 *   * sync:      Uses the `aws sync` command to minimise bandwith usage.
 *
 * @param {Object} build           The build object to be released.
 * @param {Object} opts            Options.
 * @param {String} opts.bucket     Name of the bucket to deploy to.
 * @param {String} opts.algorithm  Either 'clear', 'overwrite' or 'sync'.
 */
function release(build, opts) {
    let bucket = opts.bucket,
        algorithm = opts.algorithm || 'clear',
        releaseObject;

    return build.fetchMetadata()
        .then(() => {
            return algorithm === 'clear' ? _clearBucket(bucket) : Promise.resolve();
        }).then(() => {
            return _doRelease(build, bucket, algorithm);
        }).then((r) => {
            releaseObject = r;
            return _uploadKartFile(releaseObject, bucket);
        }).then(() => {
            return Promise.resolve(releaseObject);
        });
}

function status(project, channel) {
    return _downloadKartFile(project, channel);
}

module.exports = {
    release,
    status
}