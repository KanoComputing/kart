const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PassThrough } = require('stream');

function createZipWithDitto(basedir, file, target) {
    target += '.zip';
    return new Promise((resolve, reject) => {
        const cmd = 'ditto';
        const args = ['-ck', '--rsrc', '--sequesterRsrc', file, target];
        const p = cp.spawn(cmd, args, { cwd: basedir });
        p.on('error', e => reject(e));
        p.on('exit', (code) => {
            /* eslint eqeqeq: "off" */
            if (code != 0) {
                throw new Error(`ditto exited with a non-zero code: ${code}`);
            }
            resolve(target);
        });
    });
}

module.exports = {
    archive(buildDir) {
        const baseDir = path.dirname(buildDir);
        const name = buildDir.split('/').pop();
        const target = path.join(os.tmpdir(), 'kart-ditto-tmp');
        const stream = new PassThrough();
        createZipWithDitto(baseDir, name, target)
            .then((file) => {
                fs.createReadStream(file).pipe(stream);
            });
        return stream;
    },
    extension() {
        return 'zip';
    },
};
