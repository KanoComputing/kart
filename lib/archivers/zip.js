const archiver = require('archiver');
const path = require('path');

module.exports = {
    archive(buildDir) {
        const archive = archiver('zip');
        archive
            .glob(path.normalize('**/*'), {
                cwd: path.normalize(buildDir),
                root: path.normalize(buildDir),
            })
            .finalize();
        return archive;
    },
    extension() {
        return 'zip';
    },
};
