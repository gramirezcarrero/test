
const errorCode = "1004";
const apiCodeError = {
    code: errorCode,
    msg: {
        error: "apiCodeError",
    }
};

// Switch that redirects to corresponding API
const apiSwitch = async (apiCode, req, res) => {
    const baseApiCode = (Math.floor(Number(apiCode) / 100) * 100).toString();
    switch (baseApiCode) {
        // -- CALL QUEUES -- //
        case "2900":
            return await require('../controllers/CallQueues/callQueueController').handleCode(apiCode, req, res);
        case "2500":
            return await require('../controllers/Rates/ratesController').handleCode(apiCode, req, res);

            //return res.status(200).json({msg:'30000'})
        // -- DEFAULT -- //
        default:
            return res.status(200).json(apiCodeError);
    }
}

module.exports = apiSwitch;