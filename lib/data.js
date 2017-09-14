class Build {
    constructor (opts) {
        this.project = opts.project;
        this.channel = opts.channel;
        this.version = opts.version;
        this.revision = opts.revision;
        this.number = opts.number;
        this.arch = opts.arch;
        this.buildDate = new Date(opts.buildDate);
    }

    static fromListEntry (entry) {
        let found = entry.Key.match(/([^\/]+)\/([^\/]+)\/([^_]+)_([^_-]+)(-([a-fA-F0-9]{7}))?-(\d+)_([^_]+)\.tar\.gz/);

        if (!found) {
            return null;
        }

        return new Build({
            project: found[1],
            channel: found[2],
            version: found[4],
            revision: found[6] || null,
            number: parseInt(found[7]),
            arch: found[8],
            buildDate: new Date(entry.LastModified)
        });
    }

    get path() {
        return `${this.project}/${this.channel}/` +
               `${this.project}_${this.buildVersion}_${this.arch}.tar.gz`;
    }

    get buildVersion () {
        let buildTag = '';

        if (this.revision) {
            buildTag = this.revision + '-';
        }
        buildTag += this.number;

        return this.version + '-' + buildTag;
    }

    toJSON () {
        return JSON.stringify({
            project: this.project,
            channel: this.channel,
            version: this.version,
            revision: this.revision,
            number: this.number,
            buildDate: this.buildDate
        });
    }
}

class Release extends Build {
    constructor(opts) {
        super(opts);
        this.releaseDate = new Date(opts.releaseDate);
    }

    toJSON() {
        return JSON.stringify({
            project: this.project,
            channel: this.channel,
            version: this.version,
            revision: this.revision,
            number: this.number,
            releaseDate: this.releaseDate,
            buildDate: this.buildDate
        });
    }

    updateReleaseDate () {
        this.releaseDate = new Date();
    }
}

module.exports = {
    Build,
    Release
}