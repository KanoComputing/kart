const s3 = require('./s3');
const s3Copy = require('./s3-copy');

module.exports = {
    s3,
    's3-copy': s3Copy,
};
