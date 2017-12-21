const aws = require('aws-sdk'),
      config = require('../config'),
      Release = require('../data').Release,
      mime = require('mime-types'),
      gunzip = require('gunzip-maybe'),
      tarStream = require('tar-stream');


function _doRelease(build, target, algorithm) {
    return new Promise((resolve, reject) => {
        let s3 = new aws.S3(),
            bucketMap = {},
            extract = tarStream.extract(),
            dataStream = s3.getObject({
                Bucket: config.local.rootBucket.name,
                Key: build.path
            }).createReadStream();

        dataStream.on('error', (error) => {
            reject('Download failed: ' + error);
        });


        _listAllObjects({
            Bucket: target
        }).then((entries) => {
            entries.forEach((e) => {
                e.processed = false;
                bucketMap[e.Key] = e;
            });

            extract.on('entry', function(header, stream, next) {
                stream.on('end', function() {
                    next();
                });

                if (header.type === 'file') {
                    let entry = bucketMap[header.name];

                    if (entry) {
                        if (entry.Size === header.size && entry.LastModified === header.mtime) {
                            console.log('Skipping ' + header.name);
                            stream.resume();
                            return;
                        } else {
                            throw new Error('fuck!');
                            console.log('Overwriting ' + header.name);
                        }
                    } else {
                        console.log('Uploading ' + header.name);
                    }

                    s3.upload(
                        {
                            Bucket: target,
                            Key: header.name,
                            Body: stream,
                            ACL: 'public-read',
                            CacheControl: 'max-age=600',
                            ContentType: mime.lookup(header.name) || 'application/octet-stream'
                        },
                        (err, data) => {
                            if (err) {
                                reject('Failed deploying ' + header.name + ': ' + err);
                            }
                        }
                    );
                } else {
                    stream.resume();
                }
            });

            extract.on('finish', function() {
                /* Prepare a release object */
                let release = new Release(build);
                release.updateReleaseDate();

                /* Delete files from bucket that weren't in the archive */
                if (algorithm === 'sync') {
                    let toDelete = entries.filter(e => !e.processed);
                    toDelete.forEach(e => console.log('Deleting ' + e.Key));

                    _deleteEntries(target, toDelete).then(() => {
                        resolve(release);
                    }).catch(reject);
                } else {
                    resolve(release);
                }
            });

            /* Decompress and parse the stream */
            dataStream.pipe(gunzip()).pipe(extract);
        });
    });
}

function _listAllObjects(params, out = []) {
    return new Promise((resolve, reject) => {
        let s3 = new aws.S3();

        s3.listObjectsV2(params).promise()
            .then(data => {
                out.push(...data.Contents);

            if (data.IsTruncated) {
                let newParams = Object.assign(params, {ContinuationToken: data.NextContinuationToken});
                resolve(_listAllObjects(newParams, out));
            } else {
                resolve(out);
            }
        }).catch(reject);
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
    return _listAllObjects({Bucket: bucketName})
        .then((entries) => {
            return _deleteEntries(bucketName, entries);
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