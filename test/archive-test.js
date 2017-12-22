const kart = require('../lib'),
      fs = require('fs'),
      assert = require('assert'),
      tmp = require('tmp'),
      async = require('async'),
      AWSMock = require('mock-aws-s3'),
      ROOT_BUCKET = 'releases-root-testing',
      CONFIG_NAME = 'kart-projects.json';

let tmpDir = null;

function generateRandomString(length) {
    let result = '',
        alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHJKLMNOPQRSTUVWXYZ0123456789 ';

    for (let i = 0; i < length; i++) {
        result += alphabet[Math.floor((Math.random() * alphabet.length))];
    }

    return result;
}

function generateRandomProject() {
    return new Promise((resolve, reject) => {
        tmp.dir({unsafeCleanup: true}, (err, path, cleanupCallback) => {
            if (err) {
                return reject(err);
            }

           let fileCount= Math.floor((Math.random() * 10) + 1),
               fileNames = [];
            async.times(fileCount, (i, next) => {
                const fileLength = Math.floor((Math.random() * 1024 * 1024) + 2 * 1024),
                      fileName = `file-${i}.txt`;

                fileNames.push(fileName);
                fs.writeFile(`${path}/${fileName}`, generateRandomString(fileLength), next);
            }, (err) => {
                if (err) {
                    return reject(err);
                }

                resolve({
                    path: path,
                    cleanup: cleanupCallback,
                    files: fileNames
                });
            });
        });
    });
}

// Verify upload
function assertUpload () {

}

function assetDeploy () {

}

describe('kart', function () {
    this.timeout(10000);

    before((done) => {
        tmpDir = tmp.dirSync({unsafeCleanup: true});
        AWSMock.config.basePath = tmpDir.name;

        let s3 = AWSMock.S3();

        s3.upload({
            Bucket: ROOT_BUCKET,
            Key: CONFIG_NAME,
            Body: JSON.stringify({
                projects: {
                    "testing": {
                        github: "KanoComputing/testing",
                        channels: {
                            sync: {
                                method: "s3",
                                bucket: "testing-sync",
                                algorithm: "sync"
                            },
                            clear: {
                                method: "s3",
                                bucket: "testing-clear",
                                algorithm: "clear"
                            }
                        }
                    }
                }
            })
        }, (err, data) => {
            kart.__mockS3API(s3);

            return kart.configure({
                rootBucket: {
                    name: ROOT_BUCKET,
                    config: CONFIG_NAME
                }
            }).then(() => {
                done();
            });
        });
    });
    describe('.archive()', () => {
        it('my test', () => {
            return generateRandomProject().then((project) => {
                console.log(project);
                return kart.archive.store(project.path, 'testing', 'testing-sync', '0.1.2', null, null, {revision: '1234567'});
            }).then((build) => {
                console.log('lol', build);
            }).catch((err) => {
                console.log(err);
            });
        });
    });
    after(() => {
        tmpDir.removeCallback();
    });
});
