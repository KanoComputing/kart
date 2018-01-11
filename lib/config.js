const fs = require('fs'),
      aws = require('aws-sdk')
      os = require('os')
      s3 = require('./s3-helpers');

let configured = false,
    localConfig = {},
    remoteConfig = {};

function isConfigured() {
    return !!localConfig.rootBucket;
}

function _loadKartRc(path) {
    if (!path) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        fs.readFile(path, 'utf8', (err, data) => {
            if (!err) {
                Object.assign(localConfig, JSON.parse(data));
            }
            resolve();
        });
    });
}

function configGuard(func) {
    return (...args) => {
        if (isConfigured()) {
            return func.apply(this, args);
        } else {
            return configure({})
                .then(() => {
                    if (isConfigured()) {
                        return func.apply(this, args);
                    } else {
                        return Promise.reject('kart not configured properly');
                    }
                });
        }
    };
}

function _downloadRemoteConfig(root) {
    return new Promise((resolve, reject) => {
        s3.getInstance().getObject(
            {
                Bucket: root.name,
                Key: root.config || 'kart-projects.json'
            },
            (err, data) => {
                if (err) {
                    return reject('Unable to download remote config: ' + err);
                }

                Object.assign(remoteConfig, JSON.parse(data.Body.toString()));
                resolve();
            }
        );
    });
}

function configure(c, kartRcPath) {
    return _loadKartRc(kartRcPath)
        .then(() => {
            localConfig = Object.assign(localConfig, c);
            if (localConfig.awsKey && localConfig.awsSecret) {
                aws.config.update(
                    {
                        accessKeyId: localConfig.awsKey,
                        secretAccessKey: localConfig.awsSecret,
                    }
                );
            }

            if (localConfig.rootBucket) {
                return _downloadRemoteConfig(localConfig.rootBucket);
            }
        });
}

module.exports = {
    isConfigured,
    local: localConfig,
    remote: remoteConfig,
    configure,
    guard: configGuard
};
