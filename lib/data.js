const s3 = require('./s3-helpers');
const config = require('./config');

class Build {
    constructor(opts) {
        this.project = opts.project;
        this.channel = opts.channel;
        this.version = opts.version;
        this.number = opts.number;
        this.arch = opts.arch;
        this.metadata = opts.metadata || {};
        this.buildDate = new Date(opts.buildDate);
        this.ext = opts.ext || 'tar.gz';
    }

    static fromListEntry(entry) {
        // (-([a-fA-F0-9]{7}))?
        const found = entry.Key.match(/([^/]+)\/([^/]+)\/([^_]+)_([^_-]+)-(\d+)_([^_]+?)\.(.+)$/);

        if (!found) {
            return null;
        }

        return new Build({
            project: found[1],
            channel: found[2],
            version: found[4],
            number: parseInt(found[5], 10),
            arch: found[6],
            ext: found[7],
            metadata: {},
            buildDate: new Date(entry.LastModified),
        });
    }

    get path() {
        return `${this.project}/${this.channel}/` +
               `${this.project}_${this.buildVersion}_${this.arch}.${this.ext}`;
    }

    get publicUrl() {
        return `https://${config.local.rootBucket.name}/${this.path}`;
    }

    fetchMetadata() {
        return new Promise((resolve, reject) => {
            s3.getInstance().headObject({
                Bucket: config.local.rootBucket.name,
                Key: this.path,
            }, (err, data) => {
                if (err) {
                    return reject(err);
                }

                if (data.Metadata) {
                    this.metadata = data.Metadata;
                }
                return resolve(this.metadata);
            });
        });
    }

    get buildVersion() {
        let buildTag = '';

        // if (this.revision) {
        //     buildTag = this.revision + '-';
        // }
        buildTag += this.number;

        return `${this.version}-${buildTag}`;
    }

    toJSON() {
        return JSON.stringify({
            project: this.project,
            channel: this.channel,
            version: this.version,
            number: this.number,
            buildDate: this.buildDate,
            metadata: this.metadata,
        });
    }
}

class Release extends Build {
    constructor(opts) {
        super(opts);
        this.releaseDate = new Date(opts.releaseDate);
        this.namePattern = opts.namePattern || ':project_:version-:number_:arch.:ext';
    }

    toJSON() {
        return JSON.stringify({
            project: this.project,
            channel: this.channel,
            version: this.version,
            number: this.number,
            releaseDate: this.releaseDate,
            buildDate: this.buildDate,
            metadata: this.metadata,
        });
    }
    updateReleaseDate() {
        this.releaseDate = new Date();
    }
    get path() {
        return `${this.project}/${this.channel}/` +
               `${Release.generateName(this.namePattern, this)}`;
    }
    static generateName(pattern, build) {
        const keys = [
            'project',
            'channel',
            'version',
            'number',
            'arch',
            'ext',
        ];
        return keys.reduce((acc, key) => acc.replace(new RegExp(`:${key}`, 'g'), build[key]), pattern);
    }
}

module.exports = {
    Build,
    Release,
};
