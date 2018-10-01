const aws = require('aws-sdk');

/* Keep a global reference se we can
   override it with a mock for testing. */
let s3 = null;

function getInstance() {
    if (!s3) {
        s3 = new aws.S3();
    }

    return s3;
}

function listAllObjects(params, out = []) {
    return new Promise((resolve, reject) => {
        try {
            getInstance().listObjectsV2(params, (err, data) => {
                if (err) {
                    return reject(err);
                }

                out.push(...data.Contents);

                if (data.IsTruncated) {
                    const newParams = Object.assign(params, {
                        ContinuationToken: data.NextContinuationToken,
                    });
                    return resolve(listAllObjects(newParams, out));
                }
                return resolve(out);
            });
        } catch (err) {
            if (err.code === 'ENOENT' && err.syscall === 'scandir') {
                resolve([]);
            } else {
                reject(err);
            }
        }
    });
}


function deleteEntries(bucketName, entries) {
    const p = entries.map(entry => new Promise((resolve, reject) => {
        if (!entry.Key.match(/\/$/)) {
            getInstance().deleteObject(
                {
                    Bucket: bucketName,
                    Key: entry.Key,
                },
                (err) => {
                    if (err) {
                        return reject(new Error(`Failed to remove ${entry.Key}: ${err.message}`));
                    }

                    return resolve(entry.Key);
                },
            );
        }
    }));

    return Promise.all(p);
}

function clearBucket(bucketName) {
    return listAllObjects({ Bucket: bucketName })
        .then(entries => deleteEntries(bucketName, entries));
}

module.exports = {
    listAllObjects,
    deleteEntries,
    clearBucket,
    getInstance,

    /* For testing only */
    __mockAPI: (mock) => {
        s3 = mock;
    },
};
