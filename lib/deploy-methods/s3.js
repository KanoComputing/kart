const config = require('../config'),
      Release = require('../data').Release,
      mime = require('mime-types'),
      gunzip = require('gunzip-maybe'),
      tarStream = require('tar-stream'),
      s3 = require('../s3-helpers');

function _updateProgress(reporter, message) {
    if (reporter) {
        reporter.emit('update', {message});
    }
}

function _doRelease(build, target, algorithm, reporter) {
    return new Promise((resolve, reject) => {
        let bucketMap = {},
            extract = tarStream.extract(),
            dataStream = s3.getInstance().getObject({
                Bucket: config.local.rootBucket.name,
                Key: build.path
            }).createReadStream();

        dataStream.on('error', (error) => {
            reject('Download failed: ' + error);
        });

        s3.listAllObjects({
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
                        entry.processed = true;
                        if (entry.Size === header.size && entry.LastModified === header.mtime) {
                            _updateProgress(reporter, 'Skipping ' + header.name);
                            stream.resume();
                            return;
                        } else {
                            _updateProgress(reporter, 'Overwriting ' + header.name);
                        }
                    } else {
                        _updateProgress(reporter, 'Uploading ' + header.name);
                    }

                    s3.getInstance().upload(
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
                    toDelete.forEach(e => _updateProgress(reporter, 'Deleting ' + e.Key));

                    s3.deleteEntries(target, toDelete).then(() => {
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

function _uploadKartFile(release, target) {
    return new Promise((resolve, reject) => {
        s3.getInstance().upload(
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
        s3.getInstance().getObject(
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
 * @param {String} opts.reporter   An optional event listener to report events.
 */
function release(build, opts) {
    let bucket = opts.bucket,
        algorithm = opts.algorithm || 'clear',
        releaseObject;

    return build.fetchMetadata()
        .then(() => {
            return algorithm === 'clear' ? s3.clearBucket(bucket) : Promise.resolve();
        }).then(() => {
            return _doRelease(build, bucket, algorithm, opts.reporter);
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