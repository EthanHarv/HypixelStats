// store already defined by this point
var ipcRenderer = require('electron').ipcRenderer;

ipcRenderer.on('playerList', function (event,playerList) 
{
    updatePlayerArea(playerList);
});
ipcRenderer.on('outOfGame', function (event,outOfGame) 
{
    outOfGameUpdate(outOfGame);
});

function updatePlayerArea(playerList)
{
    if (playerList.length > 0)
    {
        $("#initialJoinDiv").remove();
    }
    // Could possibly do this aliasing stuff in main.js so it happens less. Keeping it here for now for ease of debugging in the render process
    if (store.get('aliases') == undefined)
    {
        store.set('aliases', {})
    }
    var aliases = store.get('aliases');
    for(var i = 0; i < playerList.length; i++)
    {
        if (Object.keys(aliases).includes(playerList[i])) // This name is aliased, change it.
        {
            playerList[i] = aliases[playerList[i]];
        }
    };
    if (sessionStorage.getItem('seenPlayers') == null)
    {
        sessionStorage.setItem('seenPlayers', []);
    }
    // Session storage so it doesn't spam someone who's stubborn, but still reminds them. playerList.Length > 4 for cases where a whole party joins at once.
    // (A whole party joining at once, the key owners's name can end up at the end of the of the 4)
    // Check infoBar status to check the message isn't already sent.
    if (sessionStorage.getItem('checkForAndShowWarningOfNickedAccount') !== "shown" && playerList.length > 4)
    {
        if ((!playerList.includes(store.get('key_owner')) || playerList.length > 16))
        {
            if($('#infoBarHolder').html().trim() == "")
            {
                infoBarMessage('', "<span class='text-danger' id='nickAltBanner'>Nick/Alt Detected</span>", "Hey! It looks like you're playing nicked or on an alt.\
                <br>If you're nicked, please go to <a href='./bootstrap/aliases.html'><code>Player Lists -> Aliases/Nick Hider</code></a> \
                and put your nick in as an alias to your account name. <b class='text-danger'>Update this whenever you change your nick.</b>\
                <br>If you're on an alt, please update your API key to the API key of the alt account. \
                <br>Any time you join on a different account, just generate a new API key with <code>/api new</code> and the program will auto-detect it!\
                <br>If you don't do this, the program can have a difficult time removing old players, and often won't purge the list at <i>all</i>.\
                <button class='btn btn-secondary warningButton' style='float: right;'>Hide This Message</button>\
                <script>$('.warningButton').click(function(){$('#infoBarHolder').html(''); sessionStorage.setItem('checkForAndShowWarningOfNickedAccount', 'shown');})</script>", 999999);
            }
        }
        else
        {
            $('#nickAltBanner').closest('#infoBar').remove();
        }
    }
    sessionStorage.setItem('seenPlayers', [...new Set([...sessionStorage.getItem('seenPlayers').split(','),...playerList])].filter(function (el) {return el != "";})); // Should be O(n)? I think
    $(".playerCard").each(function(index, card) // Keep old card data if player still in, delete data if card is no longer relevent
    {
        if (card == undefined) 
        {
            // Honestly not 100% sure where this comes from but handle it anyways. I'm tired don't judge me. 
            // UPDATE: 
            // Think this came from the old system where I didn't know the second term in .each() was a thing so I was just using the index. 
            // Sometimes it would get outdated data (an index that no longer exists) and would throw an error.
            // Should be fixed now, but it adds practically no extra computation time, and if something somehow goes wrong it'd catch it, so it stays.
            return;
        }
        if(playerList.includes(card.getAttribute('player'))) // If card for this player exists already, keep and ignore
        {
            const index = playerList.indexOf(card.getAttribute('player'));
            if (index > -1) {
                playerList.splice(index, 1);
            }
        }
        else 
        {
            card.remove(); // Remove a card for a player who doesn't exist anymore
            sendDataToOverlay();
        }
    });
    playerList.forEach(function(player)
    {
        $(".playerList").append('\
            <div class="col-xl-3 col-md-6 mb-4 playerCard" id="' + player + '" player="' + player + '" uuid="">\
                <div class="card border-left-primary shadow h-100 py-2">\
                <div id="obscure' + player + '" class="card" style="position: absolute; display: none; width: 100%;height: 100%;top: 0;left: 0;right: 0;bottom: 0;background-color: rgba(0,0,0,0.5);z-index: 2;cursor: pointer; border: none; pointer-events: none; border-top-left-radius: 0px; border-bottom-left-radius: 0px;"></div>\
                    <div class="card-body">\
                        <div class="row no-gutters align-items-center">\
                            <div class="col mr-2">\
                                <div class="font-weight-bold text-primary mb-1 name">' + player + '</div>\
                                <div class="h5 mb-0 font-weight-bold text-gray-800 playerDataHolder">Loading...</div>\
                            </div>\
                        </div>\
                    </div>\
                </div>\
            </div>\
        ')
    });
    playerList.forEach(function(player) 
    {
        var worker = new Worker('./bootstrap/apis_worker.js'); // Seperate this from the main thread (I think that's how this works here, I'm too used to C#)
        if (store.get('hypixel_key') == undefined)
        {
            $(".playerList").html("Please set your hypixel API key in Settings -> API Settings -> Hypixel Key");
        };
        worker.postMessage([player, store.get('hypixel_key')]);
        worker.onmessage = function (e) 
        {
            e.target.terminate(); // Free system resources. Think this lead to some crashes before I added this.

            var playerData = e.data[0];
            var playerName = e.data[1];
            var playerUUID = e.data[2];

            
            doesResolve = resolve('player.displayname', playerData); // using resolve() so it doesn't error out
            
            // The data is invalid somehow
            if (doesResolve)
            {
                playerData.internal = {};
                playerData.internal.isNick = false;
                playerData.internal.name = playerName;
                // Assign the data we go to the playerCard div. It's just a jquery thing, so handle it all in jquery
                $("#" + playerName).data('data', playerData);

                $("#" + playerName).attr('uuid', playerUUID);
                
                updatePlayerData(player);
            }
            else
            {
                playerData = {}; // Would be null, so we set to blank.
                playerData.internal = {};
                playerData.internal.isNick = true;
                playerData.internal.name = playerName;
                $("#" + playerName).data('data', playerData);

                $("#" + playerName).attr('uuid', "Nick");

                updatePlayerData(playerName);
            }
        }
    });
}

// Obscure playercards
function outOfGameUpdate(list)
{
    // Hide players who got finaled or disconnected
    list.forEach(function(player)
    {
        $('#obscure' + player).show();
    });

    // Re-show players who reconnected
    $(".playerCard").each(function(index, card)
    {
        if (!list.includes(card.getAttribute('player')))
        {
            $('#obscure' + card.getAttribute('player')).hide();
        }
    })
}

// Parse the data for all players
// Used in profileLoader.js
function updateAllPlayerData() // DO NOT DELETE
{
    $(".playerCard").each(function(index, card){
        updatePlayerData(card.id);
    });
    resortCards();
}

// Parse the data for a specific player
function updatePlayerData(player)
{
    // Get the active profile and the user data
    profile = store.get('profiles')[store.get('active_profile')];
    data = $("#" + player).data('data');
    // TODO: Possibly assign before this point so it actually sticks. I do like how this keeps stuff up-to-date though. TBD.
    data.internal.blacklist = store.get('blacklist');
    data.internal.whitelist = store.get('whitelist');
    data.internal.seenPlayers = sessionStorage.getItem('seenPlayers').split(',').filter(function (el) {return el != "";}); // I hate how scuffed this is.

    // Call a new worker and post a message
    var worker = new Worker('./bootstrap/process_data.js');
    worker.postMessage([profile, data]);
    worker.onmessage = function (e) 
    {
        data = $("#" + player).data('data'); // Need to re-get because otherwise the worker threads collide.

        // Delete the worker to free system resources
        e.target.terminate();

        // Processed data
        var pData = e.data;
        // pData contains:
        // pData.stats (object)
        // pData.color (string)
        // pData.sortValue (int or null)

        $("#" + player).data('sortValue_' + store.get('active_profile'), pData.sortValue);
        // get with $("#" + player).data('sortValue_' + store.get('active_profile'));

        // Enter data
        $("#" + player).find('.playerDataHolder').html('');

        if (data.internal.isNick) // TODO: Maybe some configuration options here.
        {
            $("#" + player).find('.playerDataHolder').append('<div class="h5 mb-0 font-weight-bold text-warning">Nick</div>');
        }

        for (var entry in profile["stats"])
        {
            if (data.internal.isNick) 
            { $("#" + player).find('.playerDataHolder').append('<div class="h5 mb-0 font-weight-bold text-gray-800" style="display: none;"><span class="data">—</span></div>'); }
            else
            {
                value = pData.stats[entry];
                hide = false;
                if (value == undefined || Number.isNaN(value))
                {
                    if (store.get('undefinedBehavior') == "blank")
                    {
                        value = "";
                    }
                    else if (store.get('undefinedBehavior') == "na")
                    {
                        value = "N/A";
                    }
                    else
                    {
                        hide = true;
                    }
                }
                // Add the data to the player card
                if (!hide)
                {
                    $("#" + player).find('.playerDataHolder').append('<div class="h5 mb-0 font-weight-bold text-gray-800">' + entry + " <span class='data'>" + value + '</span></div>');
                }
                else // We still want it to *be* there, just hidden
                {
                    $("#" + player).find('.playerDataHolder').append('<div class="h5 mb-0 font-weight-bold text-gray-800" style="display: none;"><span class="data">—</span></div>');
                }
            }
        }
        
        color = pData.color;
        if (profile['colorConditions'])
        {
            if (color)
            {
                // Set name to color
                $('#' + player).find('.name').attr('style', "color: " + color + "!important;")
                // Set border to color
                $('#' + player).find('.border-left-primary').attr('style', "border-left: .25rem solid " + color + "!important;")
                //
                $('#' + player).attr('player-color', color)
            }
            else
            {
                $('#' + player).attr('player-color', '#4e73df')
            }    
        }    
        resortCards();
    };
}


// Re-sort the cards based on their data and the current profile
function resortCards()
{
    profile = store.get('profiles')[store.get('active_profile')];
    
    // Check for a valid sort config
    if (profile['sort'])
    {
        divList = $(".playerCard");
        
        divList.sort(function(a, b)
        {
            valueA = $(a).data('sortValue_' + store.get('active_profile'));
            valueB = $(b).data('sortValue_' + store.get('active_profile'));
            try {
                // If undefined
                if (!(valueB))
                {
                    return -1;
                }
                if (!(valueA))
                {
                    return 1;
                }
                if (b.getAttribute('uuid') == "Nick" || b.getAttribute('uuid') == null) // Send nicks to end
                {
                    return -1;
                }
                if (a.getAttribute('uuid') == "Nick" || a.getAttribute('uuid') == null) // Send nicks to end
                {
                    return 1;
                };

                // If defined
                if (!Number.isFinite(valueA) && !Number.isFinite(valueB)) // Both NaN? Do nothing.
                {
                    return 0;
                }
                else if (!Number.isFinite(valueA))
                {
                    return 1;
                }
                else if (!Number.isFinite(valueB))
                {
                    return -1;
                }
                else
                {
                    return valueB - valueA;
                }
    
            } catch (error) { console.warn(error); return 0; }
        });
        // Flip array around if the user wants ascending list
        if (profile['sortOrder'] && profile.sortOrder == "ascending")
        {
            divList = divList.reverse();
        }
        divList.appendTo('.playerList');
    }

    // Sorting (or lack thereof) is done

    sendDataToOverlay();
}

function sendDataToOverlay()
{
    prof = store.get('profiles')[store.get('active_profile')];
    headers = ['Player'];
    headers = headers.concat(Object.keys(prof.stats));
    
    finalObject = [];

    finalObject.push(headers);

    colorLine = [];
    $(".playerCard").each(function(index, card){
        dataLine = [$(card).attr('player')];
        colorLine.push($(card).attr('player-color'))
        $(card).find('.data').each(function(index, data){
            dataLine = dataLine.concat(data.innerHTML);
        });
        finalObject.push(dataLine);
    });

    finalObject.push(colorLine);

    ipcRenderer.send('overlayData', finalObject);
}

ipcRenderer.on('overlayRequest', function (event) 
{
    sendDataToOverlay();
});




$.fn.reverse = [].reverse;

function resolve(path, obj) {
    return path.split('.').reduce(function(prev, curr) {
        return prev ? prev[curr] : null
    }, obj || self)
}