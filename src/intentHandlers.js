/**
    Copyright 2014-2015 Amazon.com, Inc. or its affiliates. All Rights Reserved.

    Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at

        http://aws.amazon.com/apache2.0/

    or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

// 'use strict';
var textHelper = require('./textHelper'),
    storage = require('./storage'),
    apiData = require('./data');

var ENDPOINT = 'https://2b51ae96.ngrok.io/api/game'

var registerIntentHandlers = function (intentHandlers, skillContext) {
    intentHandlers.GuessIntent = function (intent, session, response) {
        function formatUrl(str) {
            if (typeof str === 'string')
                return str.trim().replace(/\s/g, '%20')
        }

        storage.loadGame(session, function (currentGame) {
            var query = currentGame.data.currentQuestionType === 'MOVIE' ? '/guess_movie' : '/guess_actor'
            var url = ENDPOINT + query
            var currentQuestion = currentGame.data.currentQuestion

            var guess = intent.slots.Guess.value
            if (currentGame.data.currentQuestionType === 'MOVIE') {
                url = url + '?actor=' + formatUrl(currentQuestion) + '&movie=' + formatUrl(guess)
            } else {
                url = url + '?actor=' + formatUrl(guess) + '&movie=' + formatUrl(currentQuestion)
            }
            var request = require('request')
            request(url, function (error, res, body) {
              if (!error && response.statusCode == 200) {
                response.tell('Error! The API is super broken.')
                console.log(err)
              } else {
                console.log('body: ', body)
                if (JSON.parse(body).response.result === true) {
                    currentGame.save(function() {
                        if (currentGame.data.currentQuestionType === 'MOVIE') {
                            url = ENDPOINT + '/actors?movie=' + formatUrl(guess)
                        } else {
                            url = ENDPOINT + '/movies?actor=' + formatUrl(guess)
                        }
                        console.log('URL: ', url)
                        request(url, function (e, r, b) {
                            console.log('body: ', b)   
                        })
                        currentGame.data.currentQuestionType = (currentGame.data.currentQuestionType === 'ACTOR') ? 'MOVIE' : 'ACTOR'
                        var cQT = currentGame.data.currentQuestionType
                        currentGame.data.previousAnswer = currentGame.data.currentQuestion
                        currentGame.data.currentQuestion = guess
                        nextQuestion = cQT === 'ACTOR' ? `Name another actor found in ${guess}` : `Name another movie ${guess} is in`
                        response.ask(`${guess} is correct! ${nextQuestion}`)
                    })
                } else {
                    currentGame.data.currentQuestionType = 'MOVIE'
                    // var cQ = currentGame.data.currentQuestion = res.randomMovie
                    response.ask(`Sorry, ${guess} is incorrect, to play again, say new game.`)
                }
              }
            })
        })
    };

    intentHandlers.NewGameIntent = function (intent, session, response) {
        storage.loadGame(session, function (currentGame) {
            currentGame.save(function () {
                var url = ENDPOINT + '/new'
                var request = require('request')
                request(url, function (error, res, body) {
                    if (!error && response.statusCode == 200) {
                        response.tell('API Error!')
                    } else {
                        currentGame.data.currentQuestionType = 'MOVIE'
                        currentGame.data.currentQuestion = JSON.parse(body).response
                        response.ask('The actor is ' + currentGame.data.currentQuestion + ', please guess a movie.')
                    }
                })
            });
        });
    };

    intentHandlers.AddPlayerIntent = function (intent, session, response) {
        //add a player to the current game,
        //terminate or continue the conversation based on whether the intent
        //is from a one shot command or not.
        var newPlayerName = textHelper.getPlayerName(intent.slots.PlayerName.value);
        if (!newPlayerName) {
            response.ask('OK. Who do you want to add?', 'Who do you want to add?');
            return;
        }
        storage.loadGame(session, function (currentGame) {
            var speechOutput,
                reprompt;
            if (currentGame.data.scores[newPlayerName] !== undefined) {
                speechOutput = newPlayerName + ' has already joined the game.';
                if (skillContext.needMoreHelp) {
                    response.ask(speechOutput + ' What else?', 'What else?');
                } else {
                    response.tell(speechOutput);
                }
                return;
            }
            speechOutput = newPlayerName + ' has joined your game. ';
            currentGame.data.players.push(newPlayerName);
            currentGame.data.scores[newPlayerName] = 0;
            if (skillContext.needMoreHelp) {
                if (currentGame.data.players.length == 1) {
                    speechOutput += 'You can say, I am Done Adding Players. Now who\'s your next player?';
                    reprompt = textHelper.nextHelp;
                } else {
                    speechOutput += 'Who is your next player?';
                    reprompt = textHelper.nextHelp;
                }
            }
            currentGame.save(function () {
                if (reprompt) {
                    response.ask(speechOutput, reprompt);
                } else {
                    response.tell(speechOutput);
                }
            });
        });
    };

    intentHandlers.AddScoreIntent = function (intent, session, response) {
        //give a player points, ask additional question if slot values are missing.
        var playerName = textHelper.getPlayerName(intent.slots.PlayerName.value),
            score = intent.slots.ScoreNumber,
            scoreValue;
        if (!playerName) {
            response.ask('sorry, I did not hear the player name, please say that again', 'Please say the name again');
            return;
        }
        scoreValue = parseInt(score.value);
        if (isNaN(scoreValue)) {
            console.log('Invalid score value = ' + score.value);
            response.ask('sorry, I did not hear the points, please say that again', 'please say the points again');
            return;
        }
        storage.loadGame(session, function (currentGame) {
            var targetPlayer, speechOutput = '', newScore;
            if (currentGame.data.players.length < 1) {
                response.ask('sorry, no player has joined the game yet, what can I do for you?', 'what can I do for you?');
                return;
            }
            for (var i = 0; i < currentGame.data.players.length; i++) {
                if (currentGame.data.players[i] === playerName) {
                    targetPlayer = currentGame.data.players[i];
                    break;
                }
            }
            if (!targetPlayer) {
                response.ask('Sorry, ' + playerName + ' has not joined the game. What else?', playerName + ' has not joined the game. What else?');
                return;
            }
            newScore = currentGame.data.scores[targetPlayer] + scoreValue;
            currentGame.data.scores[targetPlayer] = newScore;

            speechOutput += scoreValue + ' for ' + targetPlayer + '. ';
            if (currentGame.data.players.length == 1 || currentGame.data.players.length > 3) {
                speechOutput += targetPlayer + ' has ' + newScore + ' in total.';
            } else {
                speechOutput += 'That\'s ';
                currentGame.data.players.forEach(function (player, index) {
                    if (index === currentGame.data.players.length - 1) {
                        speechOutput += 'And ';
                    }
                    speechOutput += player + ', ' + currentGame.data.scores[player];
                    speechOutput += ', ';
                });
            }
            currentGame.save(function () {
                response.tell(speechOutput);
            });
        });
    };

    intentHandlers.TellScoresIntent = function (intent, session, response) {
        //tells the scores in the leaderboard and send the result in card.
        storage.loadGame(session, function (currentGame) {
            var sortedPlayerScores = [],
                continueSession,
                speechOutput = '',
                leaderboard = '';
            if (currentGame.data.players.length === 0) {
                response.tell('Nobody has joined the game.');
                return;
            }
            currentGame.data.players.forEach(function (player) {
                sortedPlayerScores.push({
                    score: currentGame.data.scores[player],
                    player: player
                });
            });
            sortedPlayerScores.sort(function (p1, p2) {
                return p2.score - p1.score;
            });
            sortedPlayerScores.forEach(function (playerScore, index) {
                if (index === 0) {
                    speechOutput += playerScore.player + ' has ' + playerScore.score + 'point';
                    if (playerScore.score > 1) {
                        speechOutput += 's';
                    }
                } else if (index === sortedPlayerScores.length - 1) {
                    speechOutput += 'And ' + playerScore.player + ' has ' + playerScore.score;
                } else {
                    speechOutput += playerScore.player + ', ' + playerScore.score;
                }
                speechOutput += '. ';
                leaderboard += 'No.' + (index + 1) + ' - ' + playerScore.player + ' : ' + playerScore.score + '\n';
            });
            response.tellWithCard(speechOutput, "Leaderboard", leaderboard);
        });
    };

    intentHandlers.ResetPlayersIntent = function (intent, session, response) {
        //remove all players
        storage.newGame(session).save(function () {
            response.ask('New game started without players, who do you want to add first?', 'Who do you want to add first?');
        });
    };

    intentHandlers['AMAZON.HelpIntent'] = function (intent, session, response) {
        var speechOutput = textHelper.completeHelp;
        if (skillContext.needMoreHelp) {
            response.ask(textHelper.completeHelp + ' So, how can I help?', 'How can I help?');
        } else {
            response.tell(textHelper.completeHelp);
        }
    };

    intentHandlers['AMAZON.CancelIntent'] = function (intent, session, response) {
        if (skillContext.needMoreHelp) {
            response.tell('Okay.  Whenever you\'re ready, you can start giving points to the players in your game.');
        } else {
            response.tell('');
        }
    };

    intentHandlers['AMAZON.StopIntent'] = function (intent, session, response) {
        if (skillContext.needMoreHelp) {
            response.tell('Okay.  Whenever you\'re ready, you can start giving points to the players in your game.');
        } else {
            response.tell('');
        }
    };
};
exports.register = registerIntentHandlers;
