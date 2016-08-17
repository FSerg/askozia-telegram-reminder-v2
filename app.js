/*
	Application that sends messages to telegram with phone numbers when a customer
	cannot reach the call-center.
*/

//	******************************************* Dependencies *******************************************

var config = require('./config-real');
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

console.log("*************************************************************************************************************************");
console.log("************************************************** APP HAS BEEN STARTED *************************************************");
console.log("*************************************************************************************************************************");

//	******************************************* Express *******************************************

/*	Receive get-request containing a phone number sent by Askozia.
	Send message to telegram chat informing the operator about missed call and
	the number also allowing her to choose which intertal number to use to call back. */
app.get('/missed/:phone/:dura', function(req, res) {
	// Extracting and formatting number to dial
    var missedCall = req.params.phone;
    var phoneNumber = missedCall.replace('+',"").replace('+',"");
    var duration = req.params.dura;

	var replyText = 'Missed call from +' + phoneNumber + '. Waiting time: ' + duration + ' seconds.';
	// Build a custom inline keyboard with internal telephone extentions
	var options = {
  		reply_markup: JSON.stringify({
   			inline_keyboard: [
  				[{text:'101',callback_data:'101,'+phoneNumber},{text:'202',callback_data:'202,'+phoneNumber},{text:'301',callback_data:'301,'+phoneNumber},{text:'302',callback_data:'302,'+phoneNumber}],
  				[{text:'401',callback_data:'401,'+phoneNumber},{text:'402',callback_data:'402,'+phoneNumber},{text:'501',callback_data:'501,'+phoneNumber},{text:'502',callback_data:'502,'+phoneNumber}]
			]

  		})
	};

	// Send a message with inline buttons to the chat
	bot.sendMessage(config.chatid, replyText, options);
	res.send(200,{result: 'ok'});
});

app.listen(config.app_port, function () {
  //console.log('App started at ' + config.app_port + ' port!');
});

//	******************************************* Telegram *******************************************

// Respond to callback querry from the previous message
bot.on('callback_query', function (msg) {
	// Extract internal number from JSON
	var ext = msg.data;
	var arr = ext.split(",");
	var customerNum = arr[1];
	var operatorNum = arr[0];

	// Create different message options
	var message = msg.message.text;
	var midMsg = message + "\n⚠️" + operatorNum + " dialing " + customerNum + '...';

	/*  After a handful of attempts to make the inline keyboard stay after changing the message text
		inserting json object with keyboard in it appeared to be a fine workaround. */
	var idKboard = {message_id: msg.message.message_id, chat_id: msg.message.chat.id, reply_markup: JSON.stringify({
   			inline_keyboard: [
  				[{text:'101',callback_data:'101,'+customerNum},{text:'202',callback_data:'202,'+customerNum},{text:'301',callback_data:'301,'+customerNum},{text:'302',callback_data:'302,'+customerNum}],
  				[{text:'401',callback_data:'401,'+customerNum},{text:'402',callback_data:'402,'+customerNum},{text:'501',callback_data:'501,'+customerNum},{text:'502',callback_data:'502,'+customerNum}]
			]
  		})
	};
	// Extract number to dial from  message text
	bot.answerCallbackQuery(msg.id, 'Dialing +' + customerNum + '...',false);
	// Change the message text to assure the operator that ths number has been called
	bot.editMessageText(midMsg, idKboard);
	// Call Asterisk manager method that will initiate dialing
	dial(customerNum,operatorNum, callback, message, idKboard);
});

//	******************************************* Asterisk *******************************************

/*
	Initiating a phone call. It first calls the operator and once she accepted the call it dials the customer.

	Full list of Asterisk actions may be found at:
	https://wiki.asterisk.org/wiki/display/AST/Asterisk+11+AMI+Actions
*/

function dial(num, exten, callback, message, array) {
	ami.action({
  			'action': 'originate',
  			'channel':  'SIP/' + exten,
  			'context': config.local_context,
  			'CallerId': 'Alfa Medcenter',
  			'timeout': '6000',
  			'exten': num,
  			'priority': '1'
		}, function(err_ami, res_ami) {
			if (res_ami.response === "Success") {
				//ami.on('managerevent', function(evt) { console.log(evt) });
				ami.on('bridge', function(evt) {
					// check if we got answer & that it's not two operators calling each other
					if (evt.bridgestate === "Link" && evt.callerid2 === num) {
						callback(message + "\n✅ "+exten+" reached +" + num , array);
					}
				});
				ami.on('hangup', function(evt) {
					// Customer dropped the call
					if (evt.cause === "17" && evt.connectedlinenum != "<unknown>") {
						callback(message + "\n📴 +"+num+" dropped call from " + exten, array);
					}
					// Customer didn't answer the call
					if (evt.cause === "21" && evt.connectedlinenum != "<unknown>") {
						callback(message + "\n🚫 +"+num+" didn't answer the call from " + exten, array);
					}
				});
			} else {
				callback(message + "\n❌ "+exten+" dropped the call to +" + num , array);
			}
		});
}

// callback function that changes message upon call result
function callback(message, array) {
	// Change the message text to assure the operator that ths number has been called
	bot.editMessageText(message, array);
}
