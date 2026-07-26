import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { DeskShipped, SwapRouted } from "../generated/PrimeDeskGateway/AquaPrimeSwapGateway";
import { Maker, Strategy, Swap } from "../generated/schema";

export function handleDeskShipped(event: DeskShipped): void {
  const makerId = event.params.maker.toHexString();
  let maker = Maker.load(makerId);
  if (maker == null) {
    maker = new Maker(makerId);
    maker.address = event.params.maker;
  }
  maker.ensName = event.params.ensName;
  maker.save();

  const strategyId = event.params.strategyHash.toHexString();
  let strategy = Strategy.load(strategyId);
  if (strategy == null) {
    strategy = new Strategy(strategyId);
    strategy.hash = event.params.strategyHash;
    strategy.maker = makerId;
    strategy.shippedAt = event.block.timestamp;
    strategy.txHash = event.transaction.hash;
  }
  strategy.baseToken = event.params.baseToken;
  strategy.quoteToken = event.params.quoteToken;
  strategy.baseBal = event.params.baseBal;
  strategy.quoteBal = event.params.quoteBal;
  strategy.save();
}

export function handleSwapRouted(event: SwapRouted): void {
  const makerId = event.params.maker.toHexString();
  let maker = Maker.load(makerId);
  if (maker == null) {
    maker = new Maker(makerId);
    maker.address = event.params.maker;
    maker.ensName = "";
    maker.save();
  }

  const id = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  const swap = new Swap(id);
  swap.taker = event.params.taker;
  swap.maker = makerId;
  swap.sellBase = event.params.sellBase;
  swap.amountIn = event.params.amountIn;
  swap.amountOut = event.params.amountOut;
  swap.winnerIndex = event.params.winnerIndex;
  swap.postSkewE18 = event.params.postSkewE18;
  swap.baseBalAfter = event.params.baseBalAfter;
  swap.quoteBalAfter = event.params.quoteBalAfter;
  swap.timestamp = event.block.timestamp;
  swap.txHash = event.transaction.hash;
  swap.save();
}
