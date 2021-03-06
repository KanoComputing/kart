const kart = require('../lib');
require('should');
const testUtil = require('./test-util');
const inquirerTest = require('inquirer-test');
const stripAnsi = require('strip-ansi');

/* globals describe, beforeEach, afterEach, it */
/* eslint func-names: "off" */

function kartBinary(subcommand, params, input, timeout) {
    let command = ['./bin/kart', subcommand, '--a', 'testing-root', '--mock-s3-root', testUtil.mockS3Root];

    timeout = timeout || 1500;

    if (params) {
        command = command.concat(params);
    }

    return inquirerTest(command, input, timeout);
}

describe('kart UI', function () {
    this.timeout(30000);

    beforeEach(() => testUtil.setupS3());
    afterEach(() => {
        testUtil.cleanupBuildDirectories();
        return testUtil.teardownS3();
    });

    describe('kart archive', () => {
        it('archive a build', () => {
            let build;
            return testUtil.generateBuildDirectory({
                fileCount: [10, 15],
                subdirs: 3,
            })
                .then(dir => kartBinary('archive', [
                    '--name', 'testing',
                    '--channel', 'sync',
                    '--build-version', '1.2.3',
                    dir.path,
                ], [])
                    .then(() => kart.archive.list('testing', 'sync'))
                    .then((builds) => {
                        builds.length.should.be.eql(1);

                        [build] = builds;
                        build.project.should.eql('testing');
                        build.channel.should.eql('sync');
                        build.version.should.eql('1.2.3');
                        build.arch.should.eql('all');
                    }));
        });
    });

    describe('kart release', () => {
        it('release a build', () => {
            let build;
            return testUtil.generateAndArchiveBuilds([
                {
                    project: 'testing', channel: 'clear', version: '1.2.3', options: { fileCount: [10, 15], subdirs: 3 },
                },
            ]).then((builds) => {
                [build] = builds;

                return kartBinary('release', [], [
                    inquirerTest.ENTER,
                    inquirerTest.DOWN, inquirerTest.DOWN, inquirerTest.ENTER,
                    inquirerTest.ENTER,
                    'y',
                ]);
            }).then((output) => {
                output = stripAnsi(output);
                output.should.match(/Deploying testing 1\.2\.3-1 to clear/);

                return testUtil.assertRelease(build.archive);
            });
        });
    });

    describe('kart status', () => {
        it('prints the latest deployed build', () => {
            let build;
            return testUtil.generateAndArchiveBuilds([
                {
                    project: 'testing', channel: 'clear', version: '1.2.3', metadata: { revision: '1234567' },
                },
            ])
                .then((builds) => {
                    [build] = builds;
                    return kart.release(build.archive);
                })
                .then(() => kartBinary('status', [], [inquirerTest.ENTER, inquirerTest.DOWN, inquirerTest.DOWN, inquirerTest.ENTER]))
                .then((output) => {
                    output = stripAnsi(output);
                    output.should.match(/Current clear release of testing:/);
                    output.should.match(/Version:\s+1\.2\.3-1/);
                    output.should.match(/Commit:\s+1234567/);
                });
        });
    });
});
