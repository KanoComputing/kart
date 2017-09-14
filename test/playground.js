const kart = require('../lib');

kart.configure({
    // awsKey: process.env.AWS_KEY,
    // awsSecret: process.env.AWS_SECRET,
    // rootBucket: {
    //     name: 'releases-root-testing',
    //     config: 'kano-releases-config.json'
    // }
}).then(() => {

    kart.archive.list('kano-code', 'staging', {sort: {key: ['version', 'build'], order: 1}})
        .then((data) => {
            console.log(data);
        }).catch((err) => {
            console.log(err);
        });

    kart.archive.store('./test/resources', 'kano-code', 'staging', '1.10.0', '1234567')
        .then((build) => {
            console.log(build);
        })
        .catch((err) => {
            console.log(err);
        });

    // kart.downloadKartFile('kano-code', 'staging')
    //     .then((data) => {
    //         console.log(data);
    //     });

}).catch((err) => {
    console.log(err);
});
