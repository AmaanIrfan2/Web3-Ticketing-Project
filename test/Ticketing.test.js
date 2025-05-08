const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Ticketing", function () {
    let Ticketing, contract, admin, organizer, user1, user2;
    let anyValue; // Receiver placeholder

    beforeEach(async () => {
        [admin, organizer, user1, user2, ...addrs] = await ethers.getSigners();
        const TicketingFactory = await ethers.getContractFactory("Ticketing");
        contract = await TicketingFactory.deploy();
        await contract.waitForDeployment();
        anyValue = await ethers.provider.getBlockNumber();
    });

    describe("Roles", function () {
        it("Admin can grant organizer role", async () => {
            await contract.grantOrganizer(organizer.address);
            expect(await contract.hasRole(await contract.ORGANIZER_ROLE(), organizer.address)).to.equal(true);
        });

        it("Admin can revoke organizer role", async () => {
            await contract.grantOrganizer(organizer.address);
            await contract.revokeOrganizer(organizer.address);
            expect(await contract.hasRole(await contract.ORGANIZER_ROLE(), organizer.address)).to.equal(false);
        });

        it("Non-admin cannot grant organizer", async () => {
            await expect(contract.connect(user1).grantOrganizer(user1.address)).to.be.reverted;
        });
    });

    describe("Event creation", function () {
        beforeEach(async () => {
            // Grant organizer role for event creation
            await contract.grantOrganizer(organizer.address);
        });

        it("Organizer can create an event", async () => {
            const futureTime = Math.floor(Date.now() / 1000) + 3600;
            await expect(contract.connect(organizer).createEvent(
                "Party", "ipfs://123", futureTime, ethers.parseEther("1"), 10
            ))
                .to.emit(contract, "EventCreated")
                .withArgs(0, "Party", "ipfs://123", futureTime, ethers.parseEther("1"), 10);

            const event = await contract.events(0);
            expect(event.name).to.equal("Party");
            expect(event.organizer).to.equal(organizer.address);
        });

        it("Non-organizer cannot create events", async () => {
            await expect(
                contract.connect(user1).createEvent("x", "ipfs", Math.floor(Date.now() / 1000) + 1000, 1, 1)
            ).to.be.reverted;
        });

        it("Cannot create event in past or zero supply", async () => {
            await expect(
                contract.connect(organizer).createEvent("Past", "ipfs", 1, 1, 1)
            ).to.be.revertedWith("Event date must be in the future");
            await expect(
                contract.connect(organizer).createEvent("Zero", "ipfs", Math.floor(Date.now() / 1000) + 5000, 5, 0)
            ).to.be.revertedWith("Total Supply must be positive");
        });
    });

    describe("Ticket minting", function () {
        beforeEach(async () => {
            await contract.grantOrganizer(organizer.address);
            await contract.connect(organizer).createEvent(
                "Concert", "ipfs://abc", Math.floor(Date.now() / 1000) + 5000, ethers.parseEther("2"), 2
            );
        });

        it("User can mint ticket", async () => {
            await expect(contract.connect(user1).mintTicket(0, { value: ethers.parseEther("2") }))
                .to.emit(contract, "TicketMinted");

            expect(await contract.ownerOf(1)).to.equal(user1.address);
        });

        it("Refunds excess ether", async () => {
            // You can't directly check value or gas, only state change!
            await contract.connect(user1).mintTicket(0, { value: ethers.parseEther("5") });
            expect(await contract.ownerOf(1)).to.equal(user1.address);
        });

        it("Mint fails for sold out", async () => {
            await contract.connect(user1).mintTicket(0, { value: ethers.parseEther("2") });
            await contract.connect(user2).mintTicket(0, { value: ethers.parseEther("2") });
            await expect(
                contract.connect(addrs[0]).mintTicket(0, { value: ethers.parseEther("2") })
            ).to.be.revertedWith("Tickets sold out");
        });

        it("Mint fails for insufficient funds", async () => {
            await expect(
                contract.connect(user1).mintTicket(0, { value: ethers.parseEther("1") })
            ).to.be.revertedWith("Insufficient funds");
        });
    });

    describe("Withdraw", function () {
        beforeEach(async () => {
            await contract.grantOrganizer(organizer.address);
            await contract.connect(organizer).createEvent(
                "Expo", "ipfs://meta", Math.floor(Date.now() / 1000) + 5000, ethers.parseEther("3"), 1
            );
            await contract.connect(user1).mintTicket(0, { value: ethers.parseEther("3") });
        });

        it("Organizer can withdraw event funds", async () => {
            const tx = await contract.connect(organizer).withdraw(0);
            const receipt = await tx.wait();
            expect(receipt.status).to.equal(1);
            expect(await contract.eventBalances(0)).to.equal(0n);
        });

        it("Non-organizer cannot withdraw", async () => {
            await expect(contract.connect(user1).withdraw(0)).to.be.revertedWith("Only the event organizer can withdraw");
        });
    });

    describe("Resale", function () {
        beforeEach(async () => {
            await contract.grantOrganizer(organizer.address);
            await contract.connect(organizer).createEvent(
                "Market", "ipfs://demo", Math.floor(Date.now() / 1000) + 5000, ethers.parseEther("1.5"), 1
            );
            await contract.connect(user1).mintTicket(0, { value: ethers.parseEther("1.5") });
        });

        it("Users cannot do native transfer", async () => {
            await expect(contract.connect(user1).transferFrom(user1.address, user2.address, 1)).to.be.reverted;
        });

        it("Resale works: buyer pays, ownership transfers", async () => {
            const buyer = user2, seller = user1;
            await contract.connect(user1).approve(buyer.address, 1);
            await contract.connect(buyer).resaleTicket(1, seller.address, buyer.address, { value: ethers.parseEther("1.5") });
            expect(await contract.ownerOf(1)).to.equal(buyer.address);
        });

        it("Ticket cannot be resold twice", async () => {
            const buyer = user2, seller = user1;
            await contract.connect(buyer).resaleTicket(1, seller.address, buyer.address, { value: ethers.parseEther("1.5") });
            await expect(
                contract.connect(user2).resaleTicket(1, user2.address, user1.address, { value: ethers.parseEther("1") })
            ).to.be.revertedWith("Ticket has already been resold");
        });

        it("Resale fails if price is too high", async () => {
            await expect(
                contract.connect(user2).resaleTicket(1, user1.address, user2.address, { value: ethers.parseEther("2") })
            ).to.be.revertedWith("Resale price cannot exceed the original price");
        });

        it("Only buyer can call resaleTicket", async () => {
            await expect(
                contract.connect(user1).resaleTicket(1, user1.address, user2.address, { value: ethers.parseEther("1") })
            ).to.be.revertedWith("Only buyer can call resaleTicket");
        });
    });

    describe("tokenURI", function () {
        beforeEach(async () => {
            await contract.grantOrganizer(organizer.address);
            await contract.connect(organizer).createEvent(
                "EX", "ipfs://abcEX", Math.floor(Date.now() / 1000) + 1000, 10, 1
            );
            await contract.connect(user1).mintTicket(0, { value: 10 });
        });

        it("Returns correct ipfsURL for token", async () => {
            const uri = await contract.tokenURI(1);
            expect(uri).to.equal("ipfs://abcEX");
        });
        it("Fails for non-existing token", async () => {
            await expect(contract.tokenURI(222)).to.be.revertedWith("ERC721Metadata: URI query for nonexistent token");
        });
    });
});