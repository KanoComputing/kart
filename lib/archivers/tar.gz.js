const tarFs = require('tar-fs'),
      zlib = require('zlib');

module.exports = {
    archive(buildDir) {
        let gzip = zlib.createGzip(),
        stream = tarFs.pack(buildDir);
        return stream.pipe(gzip);
    },
    extension() {
        return 'tar.gz';
    },
};
