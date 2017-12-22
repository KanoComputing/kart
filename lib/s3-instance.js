const aws = require('aws-sdk');

/* Keep a global reference se we can
   override it with a mock for testing. */
let s3 = new aws.S3();

function __mockS3API(mock) {
    s3 = mock;
    s3.__mockS3API = __mockS3API;
}

s3.__mockS3API = __mockS3API;
module.exports = s3;