const aws = require('aws-sdk'),
      TarGz = require('tar.gz'),
      stream = require('stream'),
      config = require('../config'),
      Release = require('../data').Release,
      mime = require('mime-types');


function _doRelease(build, target) {
    return new Promise((resolve, reject) => {
        let s3 = new aws.S3();
        s3.getObject(
            {
                Bucket: config.local.rootBucket.name,
                Key: build.path
            },
            (err, data) => {
                if (err) {
                    return reject('Failed to download build archive: ' + err);
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
                                ACL: 'public-read',
                                CacheControl: 'max-age=600',
                                ContentType: mime.lookup(entry.path) || 'application/octet-stream'
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
                    let release = new Release(build);
                    release.updateReleaseDate();
                    
                    resolve(release);
                });
            }
        );
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

function release(build, opts) {
    let bucket = opts.bucket,
        releaseObject;

    return build.fetchMetadata()
        .then(() => {
            return _clearBucket(bucket)
        }).then(() => {
            return _doRelease(build, bucket);
        }).then((r) => {
            releaseObject = r;
            _uploadKartFile(releaseObject, bucket);
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