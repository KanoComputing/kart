const kart = require('../lib');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
/* eslint no-unused-vars: "off" */
const should = require('should');
const tmp = require('tmp');
const async = require('async');
const AWSMock = require('mock-aws-s3');

const gunzip = require('gunzip-maybe');
const tarStream = require('tar-stream');


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
                testing: {
                    github: 'KanoComputing/testing',
                    channels: {
                        sync: {
                            deploy: {
                                method: 's3',
                                bucket: 'testing-sync',
                                algorithm: 'sync',
                            },
                            url: 'https://testing-project.lol',
                        },
                        overwrite: {
                            deploy: {
                                method: 's3',
                                bucket: 'testing-overwrite',
                                algorithm: 'overwrite',
                            },
                        },
                        clear: {
                            deploy: {
                                method: 's3',
                                bucket: 'testing-clear',
                                algorithm: 'clear',
                            },
                        },
                        copy: {
                            deploy: {
                                method: 's3-copy',
                                track: 'testing-public',
                            },
                        },
                        rename: {
                            deploy: {
                                method: 's3-copy',
                                track: 'testing-public',
                                namePattern: ':project-:version.:ext',
                            },
                        },
                    },
                },
            },
        };

        this.tmpDir = null;
        this.buildDirectories = [];
        this.s3 = null;
    }

    setupS3() {
        this.tmpDir = tmp.dirSync({ unsafeCleanup: true });
        AWSMock.config.basePath = this.tmpDir.name;

        return new Promise((resolve, reject) => {
            this.s3 = AWSMock.S3();
            this.s3.upload({
                Bucket: this.ROOT_BUCKET,
                Key: this.CONFIG_NAME,
                Body: JSON.stringify(this.REMOTE_CONFIG),
            }, (err, data) => {
                kart.__mockS3API(this.s3);

                return kart.configure({
                    rootBucket: {
                        name: this.ROOT_BUCKET,
                        config: this.CONFIG_NAME,
                    },
                }).then(() => {
                    resolve();
                }).catch((e) => {
                    reject(new Error(e));
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

        return kart.configure({ rootBucket: null });
    }

    get mockS3Root() {
        return this.tmpDir.name;
    }

    /* Builds */
    _generateRandomString(length) {
        let result = '';
        const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ0123456789 ';

        for (let i = 0; i < length; i += 1) {
            result += alphabet[Math.floor((Math.random() * alphabet.length))];
        }

        return result;
    }

    _generateFilesInDirectory(dirPath, count, size) {
        return new Promise((resolve, reject) => {
            const fileNames = [];

            async.times(count, (i, next) => {
                let fileLength;
                const fileName = `file-${i}.txt`;

                if (Array.isArray(size)) {
                    /* Generate a value when range is given. */
                    fileLength = Math.floor((Math.random() * size[1]) + size[0]);
                } else {
                    fileLength = size;
                }

                fileNames.push(fileName);
                fs.writeFile(
                    path.join(dirPath, fileName),
                    this._generateRandomString(fileLength),
                    next,
                );
            }, (err) => {
                if (err) {
                    return reject(err);
                }

                return resolve(fileNames);
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
            options.fileCount =
                Math.floor((Math.random() * options.fileCount[1]) + options.fileCount[0]);
        }

        if (Array.isArray(options.subdirs)) {
            options.subdirs = Math.floor((Math.random() * options.subdirs[1]) + options.subdirs[0]);
        }

        return new Promise((resolve, reject) => {
            tmp.dir({ unsafeCleanup: true }, (err, tmpPath, cleanupCallback) => {
                if (err) {
                    return reject(err);
                }

                const filesPerSubdir = Math.ceil(options.fileCount / (options.subdirs + 1));
                const subdirs = [''];
                let promises;
                let allNames = [];

                async.times(options.subdirs, (i, next) => {
                    const dirname = `dir-${i}`;
                    subdirs.push(dirname);

                    fs.mkdir(path.join(tmpPath, dirname), next);
                }, (e) => {
                    if (e) {
                        return reject(e);
                    }

                    promises = subdirs.map(prefix => this._generateFilesInDirectory(
                        path.join(tmpPath, prefix),
                        filesPerSubdir,
                        options.fileSize,
                    ));

                    return Promise.all(promises).then((namesArray) => {
                        namesArray.forEach((names, i) => {
                            allNames = allNames.concat(names
                                .map(name => path.join(subdirs[i], name)));
                        });

                        const build = {
                            path: tmpPath,
                            cleanup: cleanupCallback,
                            files: allNames,
                        };

                        this.buildDirectories.push(build);
                        resolve(build);
                    });
                });
                return null;
            });
        });
    }

    /** Accepts an array of objects with build metadata as follows
     *
     * [
     *     {
     *          project: 'testing',
     *          channel: 'sync',
     *          version: '1.2.3',
     *          number: null,
     *          arch: null,
     *          metadata: {revision: '1234567'},
     *          options: {}
     *     },
     *     {
     *          project: 'testing',
     *          channel: 'sync',
     *          version: '1.2.3',
     *          number: null,
     *          arch: null,
     *          metadata: {revision: '1234567'},
     *          options: {},
     *     },
     *     ...
     * ]
     *
     */
    generateAndArchiveBuilds(builds) {
        return new Promise((resolve, reject) => {
            const results = [];
            async.eachSeries(builds, (build, done) => {
                const res = {};
                this.generateBuildDirectory(build.options).then((buildDirectory) => {
                    res.buildDirectory = buildDirectory;

                    return kart.archive.store(
                        buildDirectory.path,
                        build.project,
                        build.channel,
                        build.version,
                        build.number,
                        build.arch,
                        build.metadata,
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

                return resolve(results);
            });
        });
    }

    cleanupBuildDirectories() {
        this.buildDirectories.forEach((buildDir) => {
            if (buildDir && buildDir.cleanup) {
                return buildDir.cleanup();
            }
            return null;
        });
        this.buildDirectories = [];
    }


    /* Asserts */
    assertArchive(buildDirectory, archive) {
        return new Promise((resolve, reject) => {
            const downloadStream = this.s3.getObject({
                Bucket: this.ROOT_BUCKET,
                Key: archive.path,
            }).createReadStream();
            const extract = tarStream.extract();
            const remainingFiles = buildDirectory.files.slice(0).map(p => path.normalize(p));

            downloadStream.on('error', (error) => {
                reject(new Error(`Download failed: ${error.message}`));
            });

            extract.on('entry', (header, stream, next) => {
                let localBuffer = null;
                let remoteBuffer = Buffer.from('');
                let fileIndex;

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
                            console.error(err);
                        } else {
                            localBuffer = data;
                        }

                        /* Start reading data */
                        stream.on('data', (d) => {
                            remoteBuffer = Buffer.concat([remoteBuffer, d]);
                        });
                    });
                } else {
                    stream.resume();
                }
            });

            extract.on('finish', () => {
                assert.equal(remainingFiles.length, 0, `${remainingFiles} not found in remote build`);
                resolve();
            });

            downloadStream.pipe(gunzip()).pipe(extract);
        });
    }

    assertFileOnS3(bucket, p, content) {
        return new Promise((resolve) => {
            this.s3.getObject({
                Bucket: bucket,
                Key: p,
            }, (err, data) => {
                assert(data, `File ${p} not found in ${bucket}`);
                assert.equal(data.Body, content, `Content of ${p} doesn't match`);
                resolve();
            });
        });
    }
    assertFileExists(bucket, p) {
        return new Promise((resolve) => {
            this.s3.getObject({
                Bucket: bucket,
                Key: p,
            }, (err, data) => {
                assert(data, `File ${p} not found in ${bucket}`);
                resolve();
            });
        });
    }
    assertRelease(archive) {
        return new Promise((resolve, reject) => {
            const downloadStream = this.s3.getObject({
                Bucket: this.ROOT_BUCKET,
                Key: archive.path,
            }).createReadStream();
            const extract = tarStream.extract();
            let projects;

            downloadStream.on('error', (error) => {
                reject(new Error(`Download failed: ${error.message}`));
            });

            extract.on('entry', (header, stream, next) => {
                let fileContent = '';

                stream.on('end', () => {
                    if (header.type !== 'directory') {
                        this.assertFileOnS3(
                            projects[archive.project].channels[archive.channel].deploy.bucket,
                            header.name,
                            fileContent,
                        )
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
                    Key: 'kart.json',
                }, (err, data) => {
                    assert(data, 'kart.json not found!');

                    const kartJSON = JSON.parse(data.Body);

                    /* eslint no-unused-expressions: "off" */
                    kartJSON.releaseDate.should.be.a.Date;
                    kartJSON.buildDate.should.be.a.Date;
                    kartJSON.should.containEql({
                        project: archive.project,
                        channel: archive.channel,
                        version: archive.version,
                        number: archive.number,
                        metadata: archive.metadata,
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
