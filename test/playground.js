const kart = require('../lib');

kart.configure({
    awsKey: process.env.AWS_KEY,
    awsSecret: process.env.AWS_SECRET,
    rootBucket: {
        name: 'releases-root-testing',
        config: 'kano-releases-config.json'
    }
}).then(() => {

    kart.list('kano-code', 'staging', {sort: {key: ['version', 'build'], order: -1}})
        .then((data) => {
            console.log(data);

            kart.release(data[0]);
        }).catch((err) => {
            console.log(err);
        });

}).catch((err) => {
    console.log(err);
});
