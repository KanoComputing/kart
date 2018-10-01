const config = require('../config');
const { Release } = require('../data');
const mime = require('mime-types');
const gunzip = require('gunzip-maybe');
const tarStream = require('tar-stream');
const s3 = require('../s3-helpers');

function _updateProgress(reporter, message) {
    if (reporter) {
        reporter.emit('update', { message });
    }
}

function _doRelease(build, target, algorithm, reporter) {
    return new Promise((resolve, reject) => {
        const bucketMap = {};
        const extract = tarStream.extract();
        const dataStream = s3.getInstance().getObject({
            Bucket: config.local.rootBucket.name,
            Key: build.path,
        }).createReadStream();

        dataStream.on('error', (error) => {
            reject(new Error(`Download failed: ${error.message}`));
        });

        s3.listAllObjects({
            Bucket: target,
        }).then((entries) => {
            entries.forEach((e) => {
                e.processed = false;
                bucketMap[e.Key] = e;
            });

            extract.on('entry', (header, stream, next) => {
                stream.on('end', () => {
                    next();
                });

                if (header.type === 'file') {
                    const entry = bucketMap[header.name];

                    if (entry) {
                        entry.processed = true;
                        if (entry.Size === header.size && entry.LastModified === header.mtime) {
                            _updateProgress(reporter, `Skipping ${header.name}`);
                            stream.resume();
                            return;
                        }
                        _updateProgress(reporter, `Overwriting ${header.name}`);
                    } else {
                        _updateProgress(reporter, `Uploading ${header.name}`);
                    }

                    s3.getInstance().upload(
                        {
                            Bucket: target,
                            Key: header.name,
                            Body: stream,
                            ACL: 'public-read',
                            CacheControl: 'max-age=600',
                            ContentType: mime.lookup(header.name) || 'application/octet-stream',
                        },
                        (err) => {
                            if (err) {
                                reject(new Error(`Failed deploying ${header.name}: ${err.message}`));
                            }
                        },
                    );
                } else {
                    stream.resume();
                }
            });

            extract.on('finish', () => {
                /* Prepare a release object */
                const rel = new Release(build);
                rel.updateReleaseDate();

                /* Delete files from bucket that weren't in the archive */
                if (algorithm === 'sync') {
                    const toDelete = entries.filter(e => !e.processed);
                    toDelete.forEach(e => _updateProgress(reporter, `Deleting ${e.Key}`));

                    s3.deleteEntries(target, toDelete).then(() => {
                        resolve(rel);
                    }).catch(reject);
                } else {
                    resolve(rel);
                }
            });

            /* Decompress and parse the stream */
            dataStream.pipe(gunzip()).pipe(extract);
        });
    });
}

function _uploadKartFile(rel, target) {
    return new Promise((resolve, reject) => {
        s3.getInstance().upload(
            {
                Bucket: target,
                Key: 'kart.json',
                Body: rel.toJSON(),
            },
            (err) => {
                if (err) {
                    return reject(new Error(`Failed uploading the kart file: ${err.message}`));
                }

                return resolve();
            },
        );
    });
}

function _downloadKartFile(project, channel) {
    return new Promise((resolve, reject) => {
        s3.getInstance().getObject(
            {
                Bucket: config.remote.projects[project].channels[channel].deploy.bucket,
                Key: 'kart.json',
            },
            (err, data) => {
                if (err) {
                    if (err.code === 'NoSuchKey') {
                        return resolve(null);
                    }
                    return reject(new Error(`Failed downloading kart.json: ${err.message}`));
                }

                return resolve(new Release(JSON.parse(data.Body.toString())));
            },
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
    const { bucket, algorithm = 'clear' } = opts;
    let releaseObject;

    return build.fetchMetadata()
        .then(() => (algorithm === 'clear' ? s3.clearBucket(bucket) : Promise.resolve())).then(() => _doRelease(build, bucket, algorithm, opts.reporter)).then((r) => {
            releaseObject = r;
            return _uploadKartFile(releaseObject, bucket);
        })
        .then(() => Promise.resolve(releaseObject));
}

function status(project, channel) {
    return _downloadKartFile(project, channel);
}

module.exports = {
    release,
    status,
};
