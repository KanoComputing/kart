const fs = require('fs');
const path = require('path');

module.exports = {
    archive(buildDir) {
        return fs.createReadStream(buildDir);
    },
    extension(buildDir) {
        return path.extname(buildDir).replace(/^\./, '');
    },
};
