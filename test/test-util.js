const kart = require('../lib'),
      s3 = require('../lib/s3-helpers'),
      fs = require('fs'),
      path = require('path'),
      assert = require('assert'),
      should = require('should'),
      tmp = require('tmp'),
      async = require('async'),
      AWSMock = require('mock-aws-s3'),

      gunzip = require('gunzip-maybe'),
      tarStream = require('tar-stream');


class TestUtil {
    /**
     * @param {String} backend Choose between mock and real backend to test against.
     */
    constructor(backend) {
        this.backend = backend || 'mock';

        this.ROOT_BUCKET = 'testing-root';
        this.CONFIG_NAME = 'kart-projects.json';
        this.REMOTE_CONFIG = {
            projects: {
                "testing": {
                    github: "KanoComputing/testing",
                    channels: {
                        sync: {
                            deploy: {
                                method: "s3",
                                bucket: "testing-sync",
                                algorithm: "sync"
                            },
                            url: 'https://testing-project.lol'
                        },
                        overwrite: {
                            deploy: {
                                method: "s3",
                                bucket: "testing-overwrite",
                                algorithm: "overwrite"
                            }
                        },
                        clear: {
                            deploy: {
                                method: "s3",
                                bucket: "testing-clear",
                                algorithm: "clear"
                            }
                        },
                        copy: {
                            deploy: {
                                method: "s3-copy",
                                track: "testing-public",
                            }
                        },
                        rename: {
                            deploy: {
                                method: "s3-copy",
                                track: "testing-public",
                                namePattern: ":project-:version.:ext"
                            }
                        }
                    }
                }
            }
        };

        this.tmpDir = null;
        this.buildDirectories = [];
        this.s3 = null;
    }

    setupS3() {
        this.tmpDir = tmp.dirSync({unsafeCleanup: true});
        AWSMock.config.basePath = this.tmpDir.name;

        return new Promise((resolve, reject) => {
            this.s3 = AWSMock.S3();
            this.s3.upload({
                Bucket: this.ROOT_BUCKET,
                Key: this.CONFIG_NAME,
                Body: JSON.stringify(this.REMOTE_CONFIG)
            }, (err, data) => {
                kart.__mockS3API(this.s3);

                return kart.configure({
                    rootBucket: {
                        name: this.ROOT_BUCKET,
                        config: this.CONFIG_NAME
                    }
                }).then(() => {
                    resolve();
                }).catch((err) => {
                    reject(new Error(err));
                });
            });
        });
    }

    // resetS3() {

    // }

    teardownS3() {
        this.tmpDir.removeCallback();
        kart.__mockS3API(null);
        this.s3 = null;

        return kart.configure({rootBucket: null});
    }

    get mockS3Root() {
        return this.tmpDir.name;
    }

    /* Builds */
    _generateRandomString (length) {
        let result = '',
            alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ0123456789 ';

        for (let i = 0; i < length; i++) {
            result += alphabet[Math.floor((Math.random() * alphabet.length))];
        }

        return result;
    }

    _generateFilesInDirectory (dirPath, count, size) {
        return new Promise((resolve, reject) => {
            let fileNames = [];

            async.times(count, (i, next) => {
                let fileLength,
                    fileName = `file-${i}.txt`;

                if (Array.isArray(size)) {
                    /* Generate a value when range is given. */
                    fileLength = Math.floor((Math.random() * size[1]) + size[0]);
                } else {
                    fileLength = size;
                }

                fileNames.push(fileName);
                fs.writeFile(path.join(dirPath, fileName), this._generateRandomString(fileLength), next);
            }, (err) => {
                if (err) {
                    return reject(err);
                }

                resolve(fileNames);
            });
        });
    }

    generateBuildDirectory(options) {
        options = options || {};
        options.fileCount = (Number.isInteger(options.fileCount) ||
                            Array.isArray(options.fileCount)) ? options.fileCount : [1, 10];
        options.fileSize = options.fileSize || [2 * 1024, 1024 * 1024];
        options.subdirs = options.subdirs || 0;

        /* Generate when range is given. */
        if (Array.isArray(options.fileCount)) {
            options.fileCount = Math.floor((Math.random() * options.fileCount[1]) + options.fileCount[0]);
        }

        if (Array.isArray(options.subdirs)) {
            options.subdirs = Math.floor((Math.random() * options.subdirs[1]) + options.subdirs[0]);
        }

        return new Promise((resolve, reject) => {
            tmp.dir({unsafeCleanup: true}, (err, tmpPath, cleanupCallback) => {
                if (err) {
                    return reject(err);
                }

                let filesPerSubdir = Math.ceil(options.fileCount / (options.subdirs + 1)),
                    subdirs = [''],
                    promises,
                    allNames = [];

                async.times(options.subdirs, (i, next) => {
                    let dirname = `dir-${i}`;
                    subdirs.push(dirname);

                    fs.mkdir(path.join(tmpPath, dirname), next);
                }, (err) => {
                    if (err) {
                        return reject(err);
                    }

                    promises = subdirs.map((prefix) => {
                        return this._generateFilesInDirectory(path.join(tmpPath, prefix), filesPerSubdir, options.fileSize);
                    });

                    Promise.all(promises).then((namesArray) => {
                        namesArray.forEach((names, i) => {
                            allNames = allNames.concat(names.map((name) => path.join(subdirs[i], name)));
                        });

                        let build = {
                            path: tmpPath,
                            cleanup: cleanupCallback,
                            files: allNames
                        };

                        this.buildDirectories.push(build);
                        resolve(build);
                    });
                });
            });
        });
    }

    /** Accepts an array of objects with build metadata as follows
     *
     * [
     *     {project: 'testing', channel: 'sync', version: '1.2.3', number: null, arch: null, metadata: {revision: '1234567'}, options: {}},
     *     {project: 'testing', channel: 'sync', version: '1.2.3', number: null, arch: null, metadata: {revision: '1234567'}, options: {}},
     *     ...
     * ]
     *
     */
    generateAndArchiveBuilds (builds) {
        return new Promise((resolve, reject) => {
            let results = [];
            async.eachSeries(builds, (build, done) => {
                let res = {};
                this.generateBuildDirectory(build.options).then((buildDirectory) => {
                    res.buildDirectory = buildDirectory;

                    return kart.archive.store(
                        buildDirectory.path,
                        build.project,
                        build.channel,
                        build.version,
                        build.number,
                        build.arch,
                        build.metadata
                    );
                }).then((archive) => {
                    res.archive = archive;
                    results.push(res);
                    done();
                }).catch(done);
            }, (err) => {
                if (err) {
                    return reject(err);
                }

                resolve(results);
            });
        });
    }

    cleanupBuildDirectories () {
        this.buildDirectories.forEach((buildDir) => {
            if (buildDir && buildDir.cleanup) {
                return buildDir.cleanup();
            }
        });
        this.buildDirectories = [];
    }


    /* Asserts */
    assertArchive (buildDirectory, archive) {
        return new Promise((resolve, reject) => {
            let downloadStream = this.s3.getObject({
                    Bucket: this.ROOT_BUCKET,
                    Key: archive.path
                }).createReadStream(),
                extract = tarStream.extract(),
                remainingFiles = buildDirectory.files.slice(0).map(p => path.normalize(p));

            downloadStream.on('error', (error) => {
                reject('Download failed: ' + error);
            });

            extract.on('entry', (header, stream, next) => {
                let localBuffer = null,
                    remoteBuffer = Buffer.from(''),
                    fileIndex;

                stream.on('end', () => {
                    if (header.type !== 'directory') {
                        assert.equal(remoteBuffer.compare(localBuffer), 0, `${header.name} doesn't match local build`);

                        remainingFiles.splice(fileIndex, 1);
                    }

                    next();
                });

                if (header.type !== 'directory') {
                    fileIndex = remainingFiles.indexOf(path.normalize(header.name));
                    assert(fileIndex >= 0, `${header.name} not found in local build`);

                    fs.readFile(`${buildDirectory.path}/${header.name}`, (err, data) => {
                        if (err) {
                            console.log(err);
                        } else {
                            localBuffer = data;
                        }

                        /* Start reading data */
                        stream.on('data', (data) => {
                            remoteBuffer = Buffer.concat([remoteBuffer, data]);
                        });
                    });
                } else {
                    stream.resume();
                }
            });

            extract.on('finish', function() {
                assert.equal(remainingFiles.length, 0, `${remainingFiles} not found in remote build`);
                resolve();
            });

            downloadStream.pipe(gunzip()).pipe(extract);
        });
    }

    assertFileOnS3 (bucket, path, content) {
        return new Promise((resolve, reject) => {
            this.s3.getObject({
                Bucket: bucket,
                Key: path
            }, (err, data) => {
                assert(data, `File ${path} not found in ${bucket}`);
                assert.equal(data.Body, content, `Content of ${path} doesn't match`);
                resolve();
            });
        });
    }
    assertFileExists(bucket, path) {
        return new Promise((resolve, reject) => {
            this.s3.getObject({
                Bucket: bucket,
                Key: path
            }, (err, data) => {
                assert(data, `File ${path} not found in ${bucket}`);
                resolve();
            });
        });
    }
    assertRelease (archive) {
        return new Promise((resolve, reject) => {
            let downloadStream = this.s3.getObject({
                    Bucket: this.ROOT_BUCKET,
                    Key: archive.path
                }).createReadStream(),
                extract = tarStream.extract(),
                projects;

            downloadStream.on('error', (error) => {
                reject('Download failed: ' + error);
            });

            extract.on('entry', (header, stream, next) => {
                let fileContent = '';

                stream.on('end', () => {
                    if (header.type !== 'directory') {
                        this.assertFileOnS3(projects[archive.project].channels[archive.channel].deploy.bucket, header.name, fileContent)
                            .then(() => {
                                next();
                            });
                    } else {
                        next();
                    }
                });

                if (header.type !== 'directory') {
                    stream.on('data', (data) => {
                        fileContent += data;
                    });
                } else {
                    stream.resume();
                }
            });

            extract.on('finish', () => {
                /* Check archive data against the deployed kart file */
                this.s3.getObject({
                    Bucket: projects[archive.project].channels[archive.channel].deploy.bucket,
                    Key: 'kart.json'
                }, (err, data) => {
                    assert(data, `kart.json not found!`);

                    let kartJSON = JSON.parse(data.Body);

                    kartJSON.releaseDate.should.be.a.Date;
                    kartJSON.buildDate.should.be.a.Date;
                    kartJSON.should.containEql({
                        project: archive.project,
                        channel: archive.channel,
                        version: archive.version,
                        number: archive.number,
                        metadata: archive.metadata
                    });

                    resolve();
                });
            });

            kart.getProjects().then((p) => {
                projects = p;
                downloadStream.pipe(gunzip()).pipe(extract);
            });
        });
    }
}

module.exports = new TestUtil('mock');