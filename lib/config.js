const fs = require('fs');
const aws = require('aws-sdk');
const s3 = require('./s3-helpers');

let localConfig = {};
const remoteConfig = {};

function isConfigured() {
    return !!localConfig.rootBucket;
}

function _loadKartRc(path) {
    if (!path) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        fs.readFile(path, 'utf8', (err, data) => {
            if (!err) {
                Object.assign(localConfig, JSON.parse(data));
            }
            resolve();
        });
    });
}

function _downloadRemoteConfig(root) {
    return new Promise((resolve, reject) => {
        s3.getInstance().getObject(
            {
                Bucket: root.name,
                Key: root.config || 'kart-projects.json',
            },
            (err, data) => {
                if (err) {
                    return reject(new Error(`Unable to download remote config: ${err.message}`));
                }

                Object.assign(remoteConfig, JSON.parse(data.Body.toString()));
                return resolve();
            },
        );
    });
}

function configure(c, kartRcPath) {
    return _loadKartRc(kartRcPath)
        .then(() => {
            localConfig = Object.assign(localConfig, c);
            if (localConfig.awsKey && localConfig.awsSecret) {
                aws.config.update({
                    accessKeyId: localConfig.awsKey,
                    secretAccessKey: localConfig.awsSecret,
                });
            }

            if (localConfig.rootBucket) {
                return _downloadRemoteConfig(localConfig.rootBucket);
            }
            return null;
        });
}

function configGuard(func) {
    return (...args) => {
        if (isConfigured()) {
            return func.apply(this, args);
        }
        return configure({})
            .then(() => {
                if (isConfigured()) {
                    return func.apply(this, args);
                }
                return Promise.reject(new Error('kart not configured properly'));
            });
    };
}

module.exports = {
    isConfigured,
    local: localConfig,
    remote: remoteConfig,
    configure,
    guard: configGuard,
};
