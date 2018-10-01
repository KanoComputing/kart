const config = require('./config');
const deployMethods = require('./deploy-methods');
const archive = require('./archive');
const s3 = require('./s3-helpers');

function getProjects() {
    return Promise.resolve(config.remote.projects);
}

function release(build, reporter) {
    if (!config.remote.projects[build.project]) {
        return Promise.reject(new Error(`Project '${build.project}' not found`));
    }

    if (!config.remote.projects[build.project].channels[build.channel]) {
        return Promise.reject(new Error(`Channel '${build.channel}' not found in project '${build.project}'`));
    }

    const opts = config.remote.projects[build.project].channels[build.channel].deploy;
    opts.reporter = reporter;

    if (deployMethods[opts.method]) {
        return deployMethods[opts.method].release(build, opts);
    }
    return Promise.reject(new Error('Deploy method not supported.'));
}

function status(project, channel) {
    if (!config.remote.projects[project]) {
        return Promise.reject(new Error(`Project '${project}' not found`));
    }

    if (!config.remote.projects[project].channels[channel]) {
        return Promise.reject(new Error(`Channel '${channel}' not found in project '${project}'`));
    }

    const opts = config.remote.projects[project].channels[channel].deploy;

    if (deployMethods[opts.method]) {
        return deployMethods[opts.method].status(project, channel);
    }
    return Promise.reject(new Error(`Deploy method ${opts.method} not supported`));
}

function getMOTD() {
    let motd = null;

    if (config.remote.motd) {
        if (Array.isArray(config.remote.motd)) {
            motd = config.remote.motd.join('\n');
        } else {
            ({ motd } = config.remote);
        }
    }

    if (motd) {
        motd = motd.replace('\\n', '\n');
        motd = motd.split('\n').map(l => `[${'MOTD'.green}]: ${l}`).join('\n');
    }

    return Promise.resolve(motd);
}


module.exports = {
    configure: config.configure,
    archive: {
        store: config.guard(archive.store),
        remove: config.guard(archive.remove),
        list: config.guard(archive.list),
    },
    getProjects: config.guard(getProjects),
    getMOTD: config.guard(getMOTD),
    release: config.guard(release),
    status: config.guard(status),

    /* For testing only */
    __mockS3API: s3.__mockAPI,
};
