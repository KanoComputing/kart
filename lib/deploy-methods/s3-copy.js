const config = require('../config'),
      { Build, Release } = require('../data'),
      mime = require('mime-types'),
      s3 = require('../s3-helpers');

function _updateProgress(reporter, message) {
    if (reporter) {
        reporter.emit('update', {message});
    }
}

function _doRelease(build, track, namePattern, reporter) {
    // Copy the original build and change the channel to the target one
    const release = new Release(Object.assign({}, build, { namePattern, channel: track }));
    // Copt the s3 object to the new location
    return (new Promise((resolve, reject) => {
        s3.getInstance().copyObject({
            Bucket: config.local.rootBucket.name,
            CopySource: `${config.local.rootBucket.name}/${build.path}`,
            Key: release.path,
        }, (err, res) => {
            if (err) {
                return reject(err);
            }
            return resolve(res);
        })
    }))
    .then(() => {
        _updateProgress(reporter, 'File moved to release channel')
        release.updateReleaseDate();
        return release;
    });
}

function _uploadKartFile(release, bucket) {
    return new Promise((resolve, reject) => {
        const releaseChannel = config.remote.projects[release.project].channels[release.channel].deploy.track;
        const build = new Build({
            project: release.project,
            channel: releaseChannel,
            version: 0,
            number: 0,
            arch: 'all',
            metadata: {},
            ext: 'tar.gz',
        });
        const p = build.path;
        const pieces = p.split('/');
        pieces.pop();
        const kartJsonPath = pieces.join('/');
        s3.getInstance().upload(
            {
                Bucket: bucket,
                Key: `${kartJsonPath}/kart.json`,
                Body: release.toJSON(),
            },
            (err, data) => {
                if (err) {
                    return reject('Failed uploading the kart file:' + err);
                }

                resolve();
            }
        );
    });
}

function _downloadKartFile(project, channel) {
    return new Promise((resolve, reject) => {
        const releaseChannel = config.remote.projects[project].channels[channel].deploy.track;
        const build = new Build({
            project,
            channel: releaseChannel,
            version: 0,
            number: 0,
            arch: 'all',
            metadata: {},
            ext: 'tar.gz',
        });
        const p = build.path;
        const pieces = p.split('/');
        pieces.pop();
        const prefix = pieces.join('/');
        s3.getInstance().getObject(
            {
                Bucket: config.local.rootBucket.name,
                Key: `${prefix}/kart.json`
            },
            (err, data) => {
                if (err) {
                    if (err.code === 'NoSuchKey') {
                        return resolve(null);
                    }
                    return reject('Failed downloading kart.json: ' + err);
                }

                resolve(new Release(JSON.parse(data.Body.toString())));
            }
        );
    });
}

/**
 * Release a build.
 *
 * Uploading algorithms:
 *   * clear:     Clears the target bucket before writing the build into it.
 *   * overwrite: Writes all the files into the bucked without clearing it out first.
 *   * sync:      Uses the `aws sync` command to minimise bandwith usage.
 *
 * @param {Object} build            The build object to be released.
 * @param {Object} opts             Options.
 * @param {String} opts.track       Target track.
 * @param {String} opts.namePattern A pattern for the naming of the released file.
 * @param {String} opts.reporter    An optional event listener to report events.
 */
function release(build, opts) {
    if (!opts.track) {
        throw new Error('No track specified');
    }
    const { track, reporter, namePattern } = opts;

    return _doRelease(build, track, namePattern, reporter)
        .then((r) => {
            return _uploadKartFile(build, config.local.rootBucket.name)
                .then(() => r);
        });
}

function status(project, channel) {
    return _downloadKartFile(project, channel);
}

module.exports = {
    release,
    status,
};
