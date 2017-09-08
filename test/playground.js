const rlib = require('../lib');

rlib.configure({
    awsKey: process.env.AWS_KEY,
    awsSecret: process.env.AWS_SECRET,
    rootBucket: {
        name: 'releases-root-testing',
        config: 'kano-releases-config.json'
    }
}).then(() => {

    rlib.list('kano-code', 'staging', {filter: {version: '1.0.7'},sort: {key: ['version', 'build'], order: 1}, limit: 1})
        .then((data) => {
            console.log(data);
        }).catch((err) => {
            console.log(err);
        });

}).catch((err) => {
    console.log(err);
});
