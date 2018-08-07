const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function createZipWithDitto(basedir, file, target) {
    target = target + '.zip';
    return new Promise((resolve, reject) => {
        let cmd = 'ditto',
            args = ['-ck', '--rsrc', '--sequesterRsrc', '--keepParent', file, target],
            p;
        console.log(`[ZIP] ${cmd} ${args.join(' ')}`);
        p = cp.spawn(cmd, args, { cwd: basedir });
        p.on('error', (e) => reject(e));
        p.stdout.on('data', (d) => {
            console.log(`[ZIP] ${d.toString()}`);
        });
        p.on('exit', (code) => {
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
    return createZipWithDitto(baseDir, name, target)
        .then(() => {
            return fs.createReadStream(`${target}.zip`);
        });
    },
    extension() {
        return 'zip';
    },
};
