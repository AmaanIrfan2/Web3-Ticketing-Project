// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol"; //OpenZeppelin standard interface used for creating NFTs
import "@openzeppelin/contracts/access/AccessControl.sol"; //provides role-based access control
import "@openzeppelin/contracts/security/ReentrancyGuard.sol"; // guards from reentrancy attack

contract Ticketing is ERC721, AccessControl, ReentrancyGuard {
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE"); // constant for ORGANIZER_ROLE

    struct EventData {
        //struct groups all the properties of the event together
        string name; //name of the event
        string ipfsURL; //url link for event details
        uint256 date; //date of the event
        uint256 price; //ticket price
        uint256 totalSupply; //total number of tickets
        uint256 minted; //how many have been sold
        address payable organizer; //Organizer of particular event
    }

    mapping(uint256 => bool) resold;

    mapping(uint256 => EventData) public events; //maps eventCount with event data to keep a list of all events
    uint256 public eventCount;

    mapping(uint256 => uint256) public eventBalances;

    mapping(uint256 => uint256) public ticketToEvent; //maps ticket id with event id to keep track of which ticket belongs to which event

    uint256 private currentTicketId; //counter that also assigns unique ticket id

    //create event to log data on blockchain (ether.js), the indexed variable is used for searching on teh blockchain easily
    event EventCreated(
        uint256 indexed eventId,
        string name,
        string ipfsURL,
        uint256 date,
        uint256 price,
        uint256 totalSupply
    );

    //event get logged when a ticket is minted
    event TicketMinted(
        uint256 indexed ticketId,
        uint256 indexed eventId,
        address owner
    );

    //contructor inherited from openzeppelin, the two arguments are name of the NFT and symbol
    constructor() ERC721("Web3EventTicket", "W3T") {
        //makes the deployer get the admin access
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    //Organizers can create a new event by giving its details
    function createEvent(
        string memory name,
        string memory ipfsURL,
        uint256 date,
        uint256 price,
        uint256 totalSupply
    ) external onlyRole(ORGANIZER_ROLE) {
        require(date > block.timestamp, "Event date must be in the future");
        //Checks tickets allowed are at least 1, saves the event, announces it, and increases the event count
        require(totalSupply > 0, "Total Supply must be positive");
        events[eventCount] = EventData( name, ipfsURL, date, price,totalSupply, 0, payable(msg.sender));

        emit EventCreated(eventCount, name, ipfsURL, date, price, totalSupply);
        eventCount++;
    }

    //Anyone can buy a ticket to an event by sending enough money; protected from hacking tricks
    function mintTicket(uint256 eventId) external payable nonReentrant {
        //Checks the event exists, tickets remain, and enough money was sent
        require(eventId < eventCount, "Invalid Event Id");
        EventData storage ev = events[eventId];
        require(ev.minted < ev.totalSupply, "Tickets sold out");
        require(msg.value >= ev.price, "Insufficient funds");

        //Creates a new unique ticket number
        currentTicketId += 1;
        uint newTicketId = currentTicketId;

        //Creates (mints) the ticket NFT for the buyer and marks which event it's for, updates # tickets sold
        _safeMint(msg.sender, newTicketId);
        ticketToEvent[newTicketId] = eventId;
        ev.minted++;
        eventBalances[eventId] += ev.price;

        uint256 excess = msg.value - ev.price;
        if (excess > 0) {
            (bool refunded, ) = msg.sender.call{value: excess}("");
            require(refunded, "Refund failed");
        }
        //Logs this ticket sale
        emit TicketMinted(newTicketId, eventId, msg.sender);
    }

    //Organizers can take all the money in teh contract to their wallet
    function withdraw(uint256 eventId) external nonReentrant {
        EventData storage ev = events[eventId];
        require(msg.sender == ev.organizer, "Only the event organizer can withdraw");
        uint256 balance = eventBalances[eventId];
        require(balance > 0, "Nothing to withdraw");

        eventBalances[eventId] = 0;
        (bool sent, ) = ev.organizer.call{value: balance}("");
        require(sent, "Withdrawal failed");
    }

    // returns the metadata URL for a given NFT ticket so wallets/marketplaces can display the correct info of that token
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "ERC721Metadata: URI query for nonexistent token");
        uint256 eventId = ticketToEvent[tokenId];
        return events[eventId].ipfsURL;
    }

    //Admins can let other people become organizers
    function grantOrganizer(address organizer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(organizer != address(0), "Cannot grant role to zero address");
        _grantRole(ORGANIZER_ROLE, organizer);
    }

    function revokeOrganizer(address organizer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(ORGANIZER_ROLE, organizer);
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        revert("Transfers are not allowed, use resaleTicket()");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public override {
        revert("Transfers are disabled, use resaleTicket()");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory _data) public override {
        revert("Transfers are disabled, use resaleTicket()");
    }

    bool private transferring = false;

    function resaleTicket(uint256 tokenId, address seller, address buyer) external payable nonReentrant {
        require(_exists(tokenId), "TokenId is invalid");
        require(ownerOf(tokenId) == seller, "Seller is not token owner");
        require(!resold[tokenId], "Ticket has already been resold");
        require(buyer != address(0), "Buyer address cannot be zero");
        require(msg.sender == buyer, "Only buyer can call resaleTicket");

        uint256 eventId = ticketToEvent[tokenId];
        uint256 maxPrice = events[eventId].price;
        require(msg.value <= maxPrice, "Resale price cannot exceed the original price");

        // Mark as resold and payout to seller
        resold[tokenId] = true;

        (bool paid, ) = seller.call{value: msg.value}("");
        require(paid, "Resale payment failed");

        // Internally enable transfer, then call _transfer
        transferring = true;
        _transfer(seller, buyer, tokenId);
        transferring = false;
    }

    function _transfer(address from, address to, uint256 tokenId) internal override {
    require(transferring, "Transfers are disabled, use resaleTicket()");
    super._transfer(from, to, tokenId);
}
}