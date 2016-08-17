module.exports = {
    'app_port': process.env.APP_PORT || 4444,
    'token': process.env.TOKEN,
    'chatid': process.env.CHATID,

    'agi_port': process.env.AGI_PORT || '5038',
    'agi_host': process.env.AGI_HOST,
    'agi_login': process.env.AGI_LOGIN,
    'agi_pass': process.env.AGI_PASS,

    'ami_login': process.env.AMI_LOGIN,
    'ami_pass': process.env.AMI_PASS,

	'local_context': process.env.LOCAL_CONTEXT
};
