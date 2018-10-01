const kart = require('../lib');
require('should');
const testUtil = require('./test-util');
const path = require('path');

/* globals describe, beforeEach, afterEach, it */
/* eslint func-names: "off" */

describe('kart.archive', function () {
    this.timeout(30000);

    beforeEach(() => testUtil.setupS3());
    afterEach(() => {
        testUtil.cleanupBuildDirectories();
        return testUtil.teardownS3();
    });
    describe('.store()', () => {
        it('with zip type', () => {
            let buildDir;

            return testUtil.generateBuildDirectory({
                fileCount: [10, 20],
            }).then((dir) => {
                buildDir = dir;
                return kart.archive.store(buildDir.path, 'testing', 'sync', '0.5.6', null, 'armv7', null, 'zip');
            }).then((archive) => {
                archive.should.containEql({
                    project: 'testing',
                    channel: 'sync',
                    version: '0.5.6',
                    number: 1,
                    arch: 'armv7',
                    ext: 'zip',
                });
            });
        });
        it('with no type', () => {
            let buildDir;

            return testUtil.generateBuildDirectory({
                fileCount: 1,
            }).then((dir) => {
                buildDir = dir;
                return kart.archive.store(path.join(buildDir.path, buildDir.files[0]), 'testing', 'sync', '0.5.6', null, 'armv7', null, 'none');
            }).then((archive) => {
                archive.should.containEql({
                    project: 'testing',
                    channel: 'sync',
                    version: '0.5.6',
                    number: 1,
                    arch: 'armv7',
                    ext: 'txt',
                });
            });
        });
        if (process.platform !== 'darwin') {
            return;
        }
        it('with ditto', () => {
            let buildDir;

            return testUtil.generateBuildDirectory({
                fileCount: [10, 20],
            }).then((dir) => {
                buildDir = dir;
                return kart.archive.store(buildDir.path, 'testing', 'sync', '0.5.6', null, 'armv7', null, 'ditto');
            }).then((archive) => {
                archive.should.containEql({
                    project: 'testing',
                    channel: 'sync',
                    version: '0.5.6',
                    number: 1,
                    arch: 'armv7',
                    ext: 'zip',
                });
            });
        });
    });
});
