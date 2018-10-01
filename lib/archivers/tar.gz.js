const tarFs = require('tar-fs');
const zlib = require('zlib');

module.exports = {
    archive(buildDir) {
        const gzip = zlib.createGzip();
        const stream = tarFs.pack(buildDir);
        return stream.pipe(gzip);
    },
    extension() {
        return 'tar.gz';
    },
};
