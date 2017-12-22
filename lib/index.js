const aws = require('aws-sdk'),
      semver = require('semver'),
      config = require('./config'),
      Build = require('./data').Build,
      Release = require('./data').Release,
      deployMethods = require('./deploy-methods'),
      archive = require('./archive');

function getProjects() {
    return Promise.resolve(config.remote.projects);
}

function release(build) {
    let opts = config.remote.projects[build.project].channels[build.channel].deploy;

    if (deployMethods[opts.method]) {
        return deployMethods[opts.method].release(build, opts);
    } else {
        return Promise.reject('Deploy method not supported.');
    }
}

function status(name, channel) {
    let opts = config.remote.projects[name].channels[channel].deploy;

    if (deployMethods[opts.method]) {
        return deployMethods[opts.method].status(name, channel);
    } else {
        return Promise.reject(`Deploy method ${opts.method} not supported`);
    }
}

function getMOTD() {
    let motd = null;

    if (config.remote.motd) {
        if (Array.isArray(config.remote.motd)) {
            motd = config.remote.motd.join("\n");
        } else {
            motd = config.remote.motd;
        }
    }

    if (motd) {
        motd = motd.replace("\\n", "\n");
        motd = motd.split("\n").map(l => `[${'MOTD'.green}]: ${l}`).join("\n");
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
    status: config.guard(status)
};