const kart = require('../lib'),
      Build = require('../lib/data').Build,
      should = require('should'),
      assert = require('assert'),
      testUtil = require('./test-util');

describe('kart', function () {
    this.timeout(30000);

    beforeEach(() => {
        return testUtil.setupS3();
    });
    afterEach(() => {
        testUtil.cleanupBuildDirectories();
        return testUtil.teardownS3();
    });

    describe('.release()', () => {
        it('normal archive', () => {
            let build;

            return testUtil.generateAndArchiveBuilds([
                {project: 'testing', channel: 'sync', version: '1.2.3', metadata: {revision: '1234567'}},
            ]).then((res) => {
                build = res[0];
                return kart.release(build.archive);
            }).then((release) => {
                release.should.containEql({
                    project: 'testing',
                    channel: 'sync',
                    version: '1.2.3',
                    metadata: {
                        revision: '1234567'
                    }
                });
                return testUtil.assertRelease(build.archive);
            });
        });
        it('non-existent archive', () => {
            let build;

            return testUtil.generateAndArchiveBuilds([
                {project: 'testing', channel: 'sync', version: '1.2.3', metadata: {revision: '1234567'}},
            ]).then((res) => {
                build = res[0];
                return kart.archive.remove(build.archive);
            }).then(() => {
                return kart.release(build.archive);
            }).should.be.rejected()
        });
        it('non-existent project', () => {
            return kart.release(new Build({
                project: 'bogus-project',
                channel: 'sync',
                version: '1.2.2',
                number: 1,
                arch: 'all',
                buildDate: new Date()
            })).should.be.rejected();
        });
        it('non-existent channel', () => {
            return kart.release(new Build({
                project: 'testing',
                channel: 'bogus-channel',
                version: '1.2.2',
                number: 1,
                arch: 'all',
                buildDate: new Date()
            })).should.be.rejected();

        });
    });

    describe('Deploy method: s3', () => {
        describe('sync algorithm', () => {
            it('empty archive', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'sync', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: 0}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('single-level archive', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'sync', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [5, 10], subdirs: 0}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('archive with subdirs', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'sync', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [10, 15], subdirs: 3}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('over same build', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'sync', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [10, 15], subdirs: 3}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('over different build', () => {
                let builds;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'sync', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [10, 15], subdirs: 3}},
                    {project: 'testing', channel: 'sync', version: '1.2.5', metadata: {revision: '2244567'}, options: {fileCount: [10, 15], subdirs: 3}},
                ]).then((res) => {
                    builds = res;
                    return kart.release(builds[0].archive);
                }).then((release) => {
                    return kart.release(builds[1].archive);
                }).then((release) => {
                    return testUtil.assertRelease(builds[1].archive, release);
                });

            });
        });

        describe('overwrite algorithm', () => {
            it('empty archive', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'overwrite', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: 0}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('single-level archive', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'overwrite', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [5, 10], subdirs: 0}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('archive with subdirs', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'overwrite', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [10, 15], subdirs: 3}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('over same build', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'overwrite', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [10, 15], subdirs: 3}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('over different build', () => {
                let builds;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'overwrite', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [10, 15], subdirs: 3}},
                    {project: 'testing', channel: 'overwrite', version: '1.2.5', metadata: {revision: '2244567'}, options: {fileCount: [10, 15], subdirs: 3}},
                ]).then((res) => {
                    builds = res;
                    return kart.release(builds[0].archive);
                }).then((release) => {
                    return kart.release(builds[1].archive);
                }).then((release) => {
                    return testUtil.assertRelease(builds[1].archive, release);
                });
            });
        });

        describe('clear algorithm', () => {
            it('empty archive', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'clear', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: 0}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('single-level archive', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'clear', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [5, 10], subdirs: 0}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('archive with subdirs', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'clear', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [10, 15], subdirs: 3}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('over same build', () => {
                let build;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'clear', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [10, 15], subdirs: 3}},
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((release) => {
                    return kart.release(build.archive);
                }).then((release) => {
                    return testUtil.assertRelease(build.archive, release);
                });
            });
            it('over different build', () => {
                let builds;

                return testUtil.generateAndArchiveBuilds([
                    {project: 'testing', channel: 'clear', version: '1.2.3', metadata: {revision: '1234567'}, options: {fileCount: [10, 15], subdirs: 3}},
                    {project: 'testing', channel: 'clear', version: '1.2.5', metadata: {revision: '2244567'}, options: {fileCount: [10, 15], subdirs: 3}},
                ]).then((res) => {
                    builds = res;
                    return kart.release(builds[0].archive);
                }).then((release) => {
                    return kart.release(builds[1].archive);
                }).then((release) => {
                    return testUtil.assertRelease(builds[1].archive, release);
                });
            });
        });
    });

    describe('Deploy method: s3-copy', () => {
        describe('to channel', () => {
            it('deploy archive', () => {
                let build, release

                return testUtil.generateAndArchiveBuilds([
                    { project: 'testing', channel: 'copy', version: '1.2.3', metadata: { revision: '1234567' }, options: { fileCount: 1, subdirs: 0 } },
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((r) => {
                    release = r;
                    return testUtil.assertFileExists(testUtil.ROOT_BUCKET, release.path);
                }).then(() => {
                    return kart.status('testing', 'copy');
                }).then((status) => {
                    assert.equal(status.version, release.version, 'Release status does not match');
                });
            });
            it('rename archive', () => {
                let build, release

                return testUtil.generateAndArchiveBuilds([
                    { project: 'testing', channel: 'rename', version: '1.2.3', metadata: { revision: '1234567' }, options: { fileCount: 1, subdirs: 0 } },
                ]).then((res) => {
                    build = res[0];
                    return kart.release(build.archive);
                }).then((r) => {
                    release = r;
                    assert.equal(release.path, 'testing/testing-public/testing-1.2.3.tar.gz');
                });
            });
        });
    });
});