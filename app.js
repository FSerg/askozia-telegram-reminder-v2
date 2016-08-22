/*
	Application that sends messages to telegram with phone numbers when a customer
	cannot reach the call-center.
*/

var config = require('./config');
var moment = require('moment');
var jobstack = [];

// Express
var express = require('express');
var app = express();

// Telegram
var TelegramBot = require('node-telegram-bot-api');
var bot = new TelegramBot(config.token, {
    polling: true
});

// Asterisk Manager
var ami = new require('asterisk-manager')(
    config.agi_port,
    config.agi_host,
    config.ami_login,
    config.ami_pass,
    true
);
ami.keepConnected();

ami.on('disconnect', function(evt) {
    console.log('ATS disconnected (' + moment().format() + '):');
    console.log(evt);
});

ami.on('connect', function(evt) {
    console.log('==========================================================');
    console.log('ATS connected! ' + '(' + moment().format() + ')');
});

//	******************************************* EXPRESS *******************************************
/*	Receive get-request containing a phone number sent by Askozia.
	Send message to telegram chat informing the operator about missed call and
	the number also allowing her to choose which intertal number to use to call back. */
app.get('/missed/:phone/:duration', function(req, res) {
    // Extracting and formatting number to dial
    var phoneNumber = req.params.phone;
    var duration = req.params.duration;

    var replyText = 'Пропущенный звонок +' + phoneNumber + ' (на линии: ' + duration + ' с.)';

    // Build a custom inline keyboard with internal telephone extentions
    var options = { reply_markup: getKeyboard(phoneNumber) };

    // Send a message with inline buttons to the chat
    bot.sendMessage(config.chatid, replyText, options);
    res.send({result: 'ok'});
});

app.listen(config.app_port, function() {
    console.log("******** APP HAS BEEN STARTED (port: " + config.app_port + ") *********");
});

//	******************************************* Telegram *******************************************

// Respond to callback querry from the previous message
bot.on('callback_query', function(msg) {
    // Extract internal number from JSON
    var ext = msg.data;
    var arr = ext.split(",");
    var operatorNum = arr[0];
    var customerNum = arr[1];

    // Create different message options
    var message = msg.message.text;
    var message_id = ''+msg.message.message_id;
    var chat_id = ''+msg.message.chat.id;
    var newMsg = message + "\n⚠️ " + operatorNum + " уже набирает...";

    // Change the message text to assure the operator that ths number has been called
    bot.editMessageText(newMsg, {message_id: message_id, chat_id: chat_id});

    // Extract number to dial from  message text
    bot.answerCallbackQuery(msg.id, 'Набираем +' + customerNum + '...', false);

    /*  After a handful of attempts to make the inline keyboard stay after changing the message text
    	inserting json object with keyboard in it appeared to be a fine workaround. */
    var jobstore = {
            message: newMsg,
            operatorNum: operatorNum,
            customerNum: customerNum,
            options: {
                message_id: msg.message.message_id,
                chat_id: msg.message.chat.id,
                reply_markup: getKeyboard(customerNum)
            }
        };
    jobstack[message_id] = jobstore;

    // Call Asterisk manager method that will initiate dialing
    dial(customerNum, operatorNum, message_id);
});

//	******************************************* Asterisk *******************************************

/*
	Initiating a phone call. It first calls the operator and once she accepted the call it dials the customer.

	Full list of Asterisk actions may be found at:
	https://wiki.asterisk.org/wiki/display/AST/Asterisk+11+AMI+Actions
*/

function dial(customerNum, operatorNum, message_id) {
    ami.action({
        'action': 'originate',
        'channel': 'SIP/' + operatorNum,
        'context': config.local_context,
        'CallerId': message_id,
        'timeout': '10000',
        'exten': customerNum,
        'priority': '1'
    }, function(err_ami, res_ami) {
        console.log(res_ami);
        if (res_ami.response === "Success") {
            // waiting ami events with any result...
        } else {
            updateMessage("❌ " + operatorNum + " отменил звонок!", message_id);
        }
    });
}

ami.on('bridge', function(evt) {
    // check if we got answer & that it's not two operators calling each other
    // console.log('bridge: ');
    // console.log(evt);
    var message_id = evt.callerid1;
    if (!jobstack[message_id]) {
        return;
    }

    var jobstore = jobstack[message_id];
    if (evt.bridgestate === "Link") {
        // console.log('bridge: ');
        // console.log(evt);
        updateMessage("✅ "+jobstore.operatorNum+" перезвонил!", message_id);
        console.log('Наш звонок состоялся!');
    }
});

ami.on('hangup', function(evt) {

    var message_id = evt.connectedlinenum;
    if (!jobstack[message_id]) {
        return;
    }
    var jobstore = jobstack[message_id];

    // Customer dropped the call
    if (evt.cause === "16") {
        updateMessage("📴 "+jobstore.operatorNum+" отменил!", message_id);
    }

    if (evt.cause === "17") {
        updateMessage("📴 +"+jobstore.customerNum+" отменил!", message_id);
    }
    // Customer didn't answer the call
    if (evt.cause === "21" && evt.connectedlinenum != "<unknown>") {
        updateMessage("🚫 +"+jobstore.customerNum+" не ответил на звонок от " + jobstore.operatorNum, message_id);
    }
});

// callback function that changes message upon call result
function updateMessage(newText, message_id) {
    // Change the message text to assure the operator that ths number has been called
    if (!jobstack[message_id]) {
        return;
    }
    var jobstore = jobstack[message_id];
    var newMessage = jobstore.message + "\n" + newText;
    bot.editMessageText(newMessage, jobstore.options);

    // после отправки сообщения убираем задание из стека
    jobstack[message_id] = undefined;
}

function getKeyboard(customerNum) {
    return JSON.stringify({
        inline_keyboard: [
          [
            {text:'201',callback_data:'201,' + customerNum},
            {text:'202',callback_data:'202,' + customerNum},
            {text:'301',callback_data:'301,' + customerNum},
            {text:'302',callback_data:'302,' + customerNum}
          ],
          [
            {text:'401',callback_data:'401,' + customerNum},
            {text:'402',callback_data:'402,' + customerNum},
            {text:'501',callback_data:'501,' + customerNum},
            {text:'502',callback_data:'502,' + customerNum}
          ]
      ]
    });
}
