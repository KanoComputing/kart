const aws = require('aws-sdk'),
      fs = require('fs'),
      os = require('os');

let configured = false,
    localConfig = {},
    remoteConfig = {};

function isConfigured() {
    return !!localConfig.rootBucket;
}

function _loadKartRc() {
    return new Promise((resolve, reject) => {
        fs.readFile(os.homedir() + '/.kartrc', 'utf8', (err, data) => {
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
        let s3 = new aws.S3();
        s3.getObject(
            {
                Bucket: root.name,
                Key: root.config
            },
            (err, data) => {
                if (err) {
                    return reject('Failed to download remote config: ' + error);
                }

                Object.assign(remoteConfig, JSON.parse(data.Body.toString()));
                resolve();
            }
        );
    });
}

function configure(c) {
    return _loadKartRc()
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